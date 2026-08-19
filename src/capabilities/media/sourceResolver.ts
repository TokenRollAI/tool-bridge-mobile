import { ToolExecutionError } from '@/capabilities/types'

import { validateAllowedMediaSource } from './sourcePolicy'

export const MAX_MEDIA_SOURCE_BYTES = 25 * 1024 * 1024

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
])
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export type MediaFetchResponse = Readonly<{
  body: ReadableStream<Uint8Array> | null
  headers: Pick<Headers, 'get'>
  status: number
  url: string
}>

export type MediaFetcher = (
  url: string,
  init: Readonly<{
    credentials: 'omit'
    redirect: 'manual'
    signal: AbortSignal
  }>,
) => Promise<MediaFetchResponse>

export interface MediaCacheFile {
  readonly uri: string
  close(): Promise<void>
  delete(): Promise<void>
  write(chunk: Uint8Array): Promise<void>
}

export interface MediaCacheStore {
  create(mimeType: string): Promise<MediaCacheFile>
}

export type ResolvedMediaSource = Readonly<{
  mimeType: string
  release(): Promise<void>
  sizeBytes: number
  uri: string
}>

type SourceResolverOptions = Readonly<{
  maxBytes?: number
  maxRedirects?: number
  timeoutMs?: number
}>

export interface MediaSourceResolver {
  resolve(
    rawUrl: string,
    allowedHosts: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<ResolvedMediaSource>
}

export class BoundedMediaSourceResolver implements MediaSourceResolver {
  readonly #maxBytes: number
  readonly #maxRedirects: number
  readonly #timeoutMs: number

  constructor(
    private readonly fetcher: MediaFetcher,
    private readonly cacheStore: MediaCacheStore,
    options: SourceResolverOptions = {},
  ) {
    this.#maxBytes = options.maxBytes ?? MAX_MEDIA_SOURCE_BYTES
    this.#maxRedirects = options.maxRedirects ?? 3
    this.#timeoutMs = options.timeoutMs ?? 30_000
  }

  async resolve(
    rawUrl: string,
    allowedHosts: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<ResolvedMediaSource> {
    signal.throwIfAborted()
    const abortController = new AbortController()
    const forwardAbort = () => { abortController.abort() }
    let timedOut = false
    let cacheFile: MediaCacheFile | null = null
    let cacheFileClosed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    signal.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, this.#timeoutMs)

    try {
      let currentUrl = validateAllowedMediaSource(rawUrl, allowedHosts).url
      let response: MediaFetchResponse | null = null
      for (let redirects = 0; redirects <= this.#maxRedirects; redirects += 1) {
        response = await this.fetcher(currentUrl, {
          credentials: 'omit',
          redirect: 'manual',
          signal: abortController.signal,
        })
        if (!REDIRECT_STATUS.has(response.status)) break
        await response.body?.cancel()
        if (redirects === this.#maxRedirects) {
          throw new ToolExecutionError('media_redirect_rejected', '媒体 redirect 次数超过上限', false)
        }
        const location = response.headers.get('location')
        if (location === null) {
          throw new ToolExecutionError('media_redirect_rejected', '媒体 redirect 缺少 Location', false)
        }
        currentUrl = validateAllowedMediaSource(new URL(location, currentUrl).toString(), allowedHosts).url
      }
      if (response === null || response.status < 200 || response.status >= 300) {
        throw new ToolExecutionError('media_fetch_failed', '媒体来源返回非成功 HTTP 状态', true)
      }
      validateAllowedMediaSource(response.url || currentUrl, allowedHosts)
      const mimeType = normalizeMimeType(response.headers.get('content-type'))
      if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
        throw new ToolExecutionError('media_mime_not_allowed', '媒体来源 MIME 不在音频 allowlist', false)
      }
      const declaredLength = parseContentLength(response.headers.get('content-length'))
      if (declaredLength !== null && declaredLength > this.#maxBytes) {
        throw new ToolExecutionError('media_too_large', '媒体声明大小超过本地上限', false)
      }
      if (response.body === null) {
        throw new ToolExecutionError('media_fetch_failed', '媒体响应没有可读取 body', true)
      }

      cacheFile = await this.cacheStore.create(mimeType)
      reader = response.body.getReader()
      let sizeBytes = 0
      let signature: Uint8Array = new Uint8Array()
      while (true) {
        abortController.signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        sizeBytes += chunk.value.byteLength
        if (sizeBytes > this.#maxBytes) {
          throw new ToolExecutionError('media_too_large', '媒体实际大小超过本地上限', false)
        }
        signature = appendSignature(signature, chunk.value)
        await cacheFile.write(chunk.value)
      }
      if (sizeBytes === 0) {
        throw new ToolExecutionError('media_fetch_failed', '媒体响应为空', true)
      }
      if (!matchesAudioSignature(mimeType, signature)) {
        throw new ToolExecutionError('media_content_invalid', '媒体字节签名与声明 MIME 不匹配', false)
      }
      await cacheFile.close()
      cacheFileClosed = true
      const completedFile = cacheFile
      let released = false
      return {
        mimeType,
        release: async () => {
          if (released) return
          released = true
          await completedFile.delete()
        },
        sizeBytes,
        uri: completedFile.uri,
      }
    } catch (error) {
      try {
        await reader?.cancel()
      } catch {
        // 原失败保持为事实真源，清理错误不覆盖它。
      }
      if (cacheFile !== null) {
        if (!cacheFileClosed) await cacheFile.close().catch(() => undefined)
        await cacheFile.delete().catch(() => undefined)
      }
      if (error instanceof ToolExecutionError) throw error
      if (signal.aborted) throw new ToolExecutionError('cancelled', '媒体解析已取消', false)
      if (timedOut) throw new ToolExecutionError('timeout', '媒体解析超过本地时限', true)
      throw new ToolExecutionError('media_fetch_failed', '媒体解析或缓存失败', true)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', forwardAbort)
      try {
        reader?.releaseLock()
      } catch {
        // 清理失败不能覆盖下载、校验或取消的原始结果。
      }
    }
  }
}

function normalizeMimeType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const normalized = value.trim()
  if (!/^\d+$/u.test(normalized)) {
    throw new ToolExecutionError('media_size_invalid', '媒体 Content-Length 无效', false)
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ToolExecutionError('media_size_invalid', '媒体 Content-Length 无效', false)
  }
  return parsed
}

function appendSignature(existing: Uint8Array, chunk: Uint8Array): Uint8Array {
  const remaining = Math.max(0, 16 - existing.byteLength)
  if (remaining === 0) return existing
  const addition = chunk.slice(0, remaining)
  const combined = new Uint8Array(existing.byteLength + addition.byteLength)
  combined.set(existing)
  combined.set(addition, existing.byteLength)
  return combined
}

function matchesAudioSignature(mimeType: string, bytes: Uint8Array): boolean {
  const ascii = (...values: readonly string[]) => values.every((value, index) => (
    bytes[index] === value.charCodeAt(0)
  ))
  if (mimeType === 'audio/flac') return ascii('f', 'L', 'a', 'C')
  if (mimeType === 'audio/ogg') return ascii('O', 'g', 'g', 'S')
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
    return ascii('R', 'I', 'F', 'F')
      && bytes[8] === 'W'.charCodeAt(0)
      && bytes[9] === 'A'.charCodeAt(0)
      && bytes[10] === 'V'.charCodeAt(0)
      && bytes[11] === 'E'.charCodeAt(0)
  }
  if (mimeType === 'audio/mp4') {
    return bytes[4] === 'f'.charCodeAt(0)
      && bytes[5] === 't'.charCodeAt(0)
      && bytes[6] === 'y'.charCodeAt(0)
      && bytes[7] === 'p'.charCodeAt(0)
  }
  if (mimeType === 'audio/webm') {
    return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  }
  if (mimeType === 'audio/mpeg') {
    return ascii('I', 'D', '3') || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
  }
  if (mimeType === 'audio/aac') {
    return bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0
  }
  return false
}
