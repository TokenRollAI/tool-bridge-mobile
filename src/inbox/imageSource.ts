import { throwIfSignalAborted } from '@/capabilities/abortSignal'
import { ToolExecutionError } from '@/capabilities/types'

import { validateInboxImageSource } from './imagePolicy'

export const MAX_INBOX_IMAGE_BYTES = 3 * 1024 * 1024
export const MAX_INBOX_IMAGE_EDGE = 4_096
export const MAX_INBOX_IMAGE_PIXELS = 16_000_000

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png'])
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export type InboxImageFetchResponse = Readonly<{
  body: ReadableStream<Uint8Array> | null
  headers: Pick<Headers, 'get'>
  status: number
  url: string
}>

export type InboxImageFetcher = (
  url: string,
  init: Readonly<{
    credentials: 'omit'
    redirect: 'manual'
    signal: AbortSignal
  }>,
) => Promise<InboxImageFetchResponse>

export interface InboxImageCacheFile {
  readonly uri: string
  close(): Promise<void>
  delete(): Promise<void>
  write(chunk: Uint8Array): Promise<void>
}

export interface InboxImageCacheStore {
  create(mimeType: string): Promise<InboxImageCacheFile>
}

export type ResolvedInboxImage = Readonly<{
  height: number
  mimeType: 'image/jpeg' | 'image/png'
  release(): Promise<void>
  sizeBytes: number
  uri: string
  width: number
}>

type InboxImageResolverOptions = Readonly<{
  maxBytes?: number
  maxRedirects?: number
  timeoutMs?: number
}>

export interface InboxImageSourceResolver {
  resolve(rawUrl: string, signal: AbortSignal): Promise<ResolvedInboxImage>
}

export class BoundedInboxImageSourceResolver implements InboxImageSourceResolver {
  readonly #maxBytes: number
  readonly #maxRedirects: number
  readonly #timeoutMs: number

  constructor(
    private readonly fetcher: InboxImageFetcher,
    private readonly cacheStore: InboxImageCacheStore,
    options: InboxImageResolverOptions = {},
  ) {
    this.#maxBytes = options.maxBytes ?? MAX_INBOX_IMAGE_BYTES
    this.#maxRedirects = options.maxRedirects ?? 3
    this.#timeoutMs = options.timeoutMs ?? 20_000
  }

  async resolve(rawUrl: string, signal: AbortSignal): Promise<ResolvedInboxImage> {
    throwIfSignalAborted(signal)
    const abortController = new AbortController()
    const forwardAbort = () => { abortController.abort() }
    let timedOut = false
    let cacheFile: InboxImageCacheFile | null = null
    let cacheFileClosed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    signal.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, this.#timeoutMs)

    try {
      let currentUrl = validateInboxImageSource(rawUrl).url
      let response: InboxImageFetchResponse | null = null
      for (let redirects = 0; redirects <= this.#maxRedirects; redirects += 1) {
        response = await this.fetcher(currentUrl, {
          credentials: 'omit',
          redirect: 'manual',
          signal: abortController.signal,
        })
        if (!REDIRECT_STATUS.has(response.status)) break
        await response.body?.cancel()
        if (redirects === this.#maxRedirects) {
          throw new ToolExecutionError('image_redirect_rejected', '信箱图片 redirect 次数超过上限', false)
        }
        const location = response.headers.get('location')
        if (location === null) {
          throw new ToolExecutionError('image_redirect_rejected', '信箱图片 redirect 缺少 Location', false)
        }
        currentUrl = validateInboxImageSource(new URL(location, currentUrl).toString()).url
      }
      if (response === null || response.status < 200 || response.status >= 300) {
        throw new ToolExecutionError('image_fetch_failed', '信箱图片来源返回非成功 HTTP 状态', true)
      }
      validateInboxImageSource(response.url || currentUrl)
      const mimeType = normalizeMimeType(response.headers.get('content-type'))
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new ToolExecutionError('image_mime_not_allowed', '信箱图片只支持 PNG 或 JPEG', false)
      }
      const declaredLength = parseContentLength(response.headers.get('content-length'))
      if (declaredLength !== null && declaredLength > this.#maxBytes) {
        throw new ToolExecutionError('image_too_large', '信箱图片声明大小超过本地上限', false)
      }
      if (response.body === null) {
        throw new ToolExecutionError('image_fetch_failed', '信箱图片响应没有可读取 body', true)
      }

      cacheFile = await this.cacheStore.create(mimeType)
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let sizeBytes = 0
      while (true) {
        throwIfSignalAborted(abortController.signal)
        const chunk = await reader.read()
        if (chunk.done) break
        sizeBytes += chunk.value.byteLength
        if (sizeBytes > this.#maxBytes) {
          throw new ToolExecutionError('image_too_large', '信箱图片实际大小超过本地上限', false)
        }
        chunks.push(chunk.value)
        await cacheFile.write(chunk.value)
      }
      if (sizeBytes === 0) {
        throw new ToolExecutionError('image_fetch_failed', '信箱图片响应为空', true)
      }
      const bytes = combineChunks(chunks, sizeBytes)
      const dimensions = inspectImage(mimeType, bytes)
      if (
        dimensions.width > MAX_INBOX_IMAGE_EDGE
        || dimensions.height > MAX_INBOX_IMAGE_EDGE
        || dimensions.width * dimensions.height > MAX_INBOX_IMAGE_PIXELS
      ) {
        throw new ToolExecutionError('image_dimensions_rejected', '信箱图片像素尺寸超过本地上限', false)
      }
      await cacheFile.close()
      cacheFileClosed = true
      const completedFile = cacheFile
      let released = false
      return {
        ...dimensions,
        mimeType: mimeType as 'image/jpeg' | 'image/png',
        release: async () => {
          if (released) return
          released = true
          await completedFile.delete()
        },
        sizeBytes,
        uri: completedFile.uri,
      }
    } catch (error) {
      try { await reader?.cancel() } catch { /* Preserve the original failure. */ }
      if (cacheFile !== null) {
        if (!cacheFileClosed) await cacheFile.close().catch(() => undefined)
        await cacheFile.delete().catch(() => undefined)
      }
      if (error instanceof ToolExecutionError) throw error
      if (signal.aborted) throw new ToolExecutionError('cancelled', '信箱图片加载已取消', false)
      if (timedOut) throw new ToolExecutionError('timeout', '信箱图片加载超过本地时限', true)
      throw new ToolExecutionError('image_fetch_failed', '信箱图片下载或校验失败', true)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', forwardAbort)
      try { reader?.releaseLock() } catch { /* Cleanup cannot change the result. */ }
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
    throw new ToolExecutionError('image_size_invalid', '信箱图片 Content-Length 无效', false)
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ToolExecutionError('image_size_invalid', '信箱图片 Content-Length 无效', false)
  }
  return parsed
}

function combineChunks(chunks: readonly Uint8Array[], sizeBytes: number): Uint8Array {
  const combined = new Uint8Array(sizeBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

function inspectImage(mimeType: string, bytes: Uint8Array): Readonly<{ height: number; width: number }> {
  const dimensions = mimeType === 'image/png' ? inspectPng(bytes) : inspectJpeg(bytes)
  if (
    dimensions === null
    || !Number.isSafeInteger(dimensions.width)
    || !Number.isSafeInteger(dimensions.height)
    || dimensions.width < 1
    || dimensions.height < 1
  ) {
    throw new ToolExecutionError(
      'image_content_invalid',
      '信箱图片字节签名或尺寸与声明 MIME 不匹配',
      false,
    )
  }
  return dimensions
}

function inspectPng(bytes: Uint8Array): Readonly<{ height: number; width: number }> | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)) return null
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null
  return { height: readUint32(bytes, 20), width: readUint32(bytes, 16) }
}

function inspectJpeg(bytes: Uint8Array): Readonly<{ height: number; width: number }> | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 3 < bytes.byteLength) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (offset + 1 >= bytes.byteLength) return null
    const segmentLength = readUint16(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) return null
      return { height: readUint16(bytes, offset + 3), width: readUint16(bytes, offset + 5) }
    }
    offset += segmentLength
  }
  return null
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)
  )
}
