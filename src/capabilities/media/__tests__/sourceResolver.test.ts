import { BoundedMediaSourceResolver } from '../sourceResolver'

import type {
  MediaCacheFile,
  MediaCacheStore,
  MediaFetcher,
  MediaFetchResponse,
} from '../sourceResolver'

class FakeCacheFile implements MediaCacheFile {
  closed = 0
  deleted = 0
  readonly uri = 'file:///private/cache/resolved.mp3'
  readonly writes: Uint8Array[] = []

  async close(): Promise<void> {
    this.closed += 1
  }

  async delete(): Promise<void> {
    this.deleted += 1
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.writes.push(chunk)
  }
}

class FakeCacheStore implements MediaCacheStore {
  readonly files: FakeCacheFile[] = []

  async create(): Promise<FakeCacheFile> {
    const file = new FakeCacheFile()
    this.files.push(file)
    return file
  }
}

function stream(...chunks: readonly number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk))
      controller.close()
    },
  })
}

function response(options: Readonly<{
  body?: ReadableStream<Uint8Array> | null
  headers?: Readonly<Record<string, string>>
  status?: number
  url?: string
}> = {}): MediaFetchResponse {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return {
    body: options.body === undefined ? stream([1, 2], [3]) : options.body,
    headers: { get: name => headers.get(name.toLowerCase()) ?? null },
    status: options.status ?? 200,
    url: options.url ?? 'https://media.example.com/final.mp3',
  }
}

function queuedFetcher(responses: readonly MediaFetchResponse[]) {
  const calls: string[] = []
  const fetcher: MediaFetcher = async (url, init) => {
    calls.push(`${init.credentials}:${init.redirect}:${url}`)
    const next = responses[calls.length - 1]
    if (next === undefined) throw new Error('unexpected fetch')
    return next
  }
  return { calls, fetcher }
}

const allowlist = new Set(['media.example.com'])

describe('BoundedMediaSourceResolver', () => {
  afterEach(() => jest.useRealTimers())

  test('手动复核 redirect/最终 URL/MIME，并按实际字节写入私有缓存', async () => {
    const first = response({
      body: stream(),
      headers: { location: '/final.mp3' },
      status: 302,
      url: 'https://media.example.com/start',
    })
    const second = response({
      body: stream([0x49, 0x44], [0x33, 4, 5]),
      headers: { 'content-length': '5', 'content-type': 'audio/mpeg; charset=binary' },
      url: 'https://media.example.com/final.mp3',
    })
    const { calls, fetcher } = queuedFetcher([first, second])
    const store = new FakeCacheStore()
    const resolved = await new BoundedMediaSourceResolver(fetcher, store).resolve(
      'https://media.example.com/start?ticket=secret',
      allowlist,
      new AbortController().signal,
    )

    expect(calls).toEqual([
      'omit:manual:https://media.example.com/start?ticket=secret',
      'omit:manual:https://media.example.com/final.mp3',
    ])
    expect(resolved).toMatchObject({
      mimeType: 'audio/mpeg',
      sizeBytes: 5,
      uri: 'file:///private/cache/resolved.mp3',
    })
    expect(store.files[0]?.writes.map(chunk => chunk.byteLength)).toEqual([2, 3])
    expect(store.files[0]?.closed).toBe(1)
    await resolved.release()
    await resolved.release()
    expect(store.files[0]?.deleted).toBe(1)
  })

  test('跨 allowlist redirect 在请求下一跳前被拒绝', async () => {
    const { calls, fetcher } = queuedFetcher([response({
      body: stream(),
      headers: { location: 'https://attacker.example/track.mp3' },
      status: 302,
      url: 'https://media.example.com/start',
    })])
    const store = new FakeCacheStore()

    await expect(new BoundedMediaSourceResolver(fetcher, store).resolve(
      'https://media.example.com/start',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'source_not_allowed' })
    expect(calls).toHaveLength(1)
    expect(store.files).toHaveLength(0)
  })

  test('即使 fetch 实现意外跟随 redirect，也复核最终 response URL', async () => {
    const { fetcher } = queuedFetcher([response({
      headers: { 'content-type': 'audio/mpeg' },
      url: 'https://attacker.example/final.mp3',
    })])
    const store = new FakeCacheStore()
    await expect(new BoundedMediaSourceResolver(fetcher, store).resolve(
      'https://media.example.com/start',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'source_not_allowed' })
    expect(store.files).toHaveLength(0)
  })

  test('错误 MIME 与 100 MiB 声明长度在创建缓存前拒绝', async () => {
    const badMime = queuedFetcher([response({
      headers: { 'content-type': 'text/html' },
    })])
    const mimeStore = new FakeCacheStore()
    await expect(new BoundedMediaSourceResolver(badMime.fetcher, mimeStore).resolve(
      'https://media.example.com/track',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'media_mime_not_allowed' })
    expect(mimeStore.files).toHaveLength(0)

    const huge = queuedFetcher([response({
      headers: {
        'content-length': String(100 * 1024 * 1024),
        'content-type': 'audio/mpeg',
      },
    })])
    const sizeStore = new FakeCacheStore()
    await expect(new BoundedMediaSourceResolver(huge.fetcher, sizeStore).resolve(
      'https://media.example.com/track',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'media_too_large' })
    expect(sizeStore.files).toHaveLength(0)
  })

  test('即使 header 声称 audio，字节签名不匹配也拒绝并清缓存', async () => {
    const { fetcher } = queuedFetcher([response({
      body: stream([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]),
      headers: { 'content-type': 'audio/mpeg' },
    })])
    const store = new FakeCacheStore()
    await expect(new BoundedMediaSourceResolver(fetcher, store).resolve(
      'https://media.example.com/track',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'media_content_invalid' })
    expect(store.files[0]?.deleted).toBe(1)
  })

  test('实际流超过硬上限时停止写入并删除 partial cache', async () => {
    const { fetcher } = queuedFetcher([response({
      body: stream([1, 2, 3], [4, 5, 6]),
      headers: { 'content-type': 'audio/mpeg' },
    })])
    const store = new FakeCacheStore()
    await expect(new BoundedMediaSourceResolver(fetcher, store, { maxBytes: 5 }).resolve(
      'https://media.example.com/track',
      allowlist,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'media_too_large' })
    expect(store.files[0]?.writes).toHaveLength(1)
    expect(store.files[0]?.deleted).toBe(1)
  })

  test('解析超时会 abort fetch，且不会留下缓存', async () => {
    jest.useFakeTimers()
    const store = new FakeCacheStore()
    const fetcher: MediaFetcher = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
    const resolution = new BoundedMediaSourceResolver(fetcher, store, { timeoutMs: 1_000 }).resolve(
      'https://media.example.com/track',
      allowlist,
      new AbortController().signal,
    )
    const expectation = expect(resolution).rejects.toMatchObject({ code: 'timeout' })
    await jest.advanceTimersByTimeAsync(1_000)
    await expectation
    expect(store.files).toHaveLength(0)
  })

  test('下载中取消会终止流并删除 partial cache', async () => {
    const store = new FakeCacheStore()
    const abortController = new AbortController()
    const fetcher: MediaFetcher = async (_url, init) => ({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([0x49, 0x44, 0x33]))
          init.signal.addEventListener('abort', () => {
            controller.error(new Error('aborted'))
          }, { once: true })
        },
      }),
      headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null },
      status: 200,
      url: 'https://media.example.com/track',
    })
    const resolution = new BoundedMediaSourceResolver(fetcher, store).resolve(
      'https://media.example.com/track',
      allowlist,
      abortController.signal,
    )
    const expectation = expect(resolution).rejects.toMatchObject({ code: 'cancelled' })
    await new Promise<void>(resolve => { setImmediate(resolve) })
    abortController.abort()
    await expectation
    expect(store.files[0]?.writes).toHaveLength(1)
    expect(store.files[0]?.deleted).toBe(1)
  })
})
