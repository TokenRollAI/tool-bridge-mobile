import { createReactNativeAbortSignal } from '@/testFixtures/reactNativeAbortSignal'

import {
  BoundedInboxImageSourceResolver,
  type InboxImageCacheFile,
  type InboxImageCacheStore,
  type InboxImageFetcher,
  type InboxImageFetchResponse,
} from '../imageSource'

class FakeCacheFile implements InboxImageCacheFile {
  closed = 0
  deleted = 0
  readonly uri = 'file:///private/cache/chart.png'
  readonly writes: Uint8Array[] = []

  async close(): Promise<void> { this.closed += 1 }
  async delete(): Promise<void> { this.deleted += 1 }
  async write(chunk: Uint8Array): Promise<void> { this.writes.push(chunk) }
}

class FakeCacheStore implements InboxImageCacheStore {
  readonly files: FakeCacheFile[] = []
  async create(): Promise<FakeCacheFile> {
    const file = new FakeCacheFile()
    this.files.push(file)
    return file
  }
}

function png(width: number, height: number): number[] {
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
  ]
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
}> = {}): InboxImageFetchResponse {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return {
    body: options.body === undefined ? stream(png(320, 180)) : options.body,
    headers: { get: name => headers.get(name.toLowerCase()) ?? null },
    status: options.status ?? 200,
    url: options.url ?? 'https://img.example.com/chart.png',
  }
}

function queuedFetcher(responses: readonly InboxImageFetchResponse[]) {
  const calls: string[] = []
  const fetcher: InboxImageFetcher = async (url, init) => {
    calls.push(`${init.credentials}:${init.redirect}:${url}`)
    const next = responses[calls.length - 1]
    if (next === undefined) throw new Error('unexpected fetch')
    return next
  }
  return { calls, fetcher }
}

describe('BoundedInboxImageSourceResolver', () => {
  test('允许跨 hostname HTTPS redirect，逐跳复核并只返回私有 file URI', async () => {
    const first = response({
      body: stream(),
      headers: { location: 'https://cdn.example.net/chart.png' },
      status: 302,
      url: 'https://img.example.com/start',
    })
    const second = response({
      headers: { 'content-length': '24', 'content-type': 'image/png' },
      url: 'https://cdn.example.net/chart.png',
    })
    const { calls, fetcher } = queuedFetcher([first, second])
    const store = new FakeCacheStore()
    const resolved = await new BoundedInboxImageSourceResolver(
      fetcher,
      store,
    ).resolve(
      'https://img.example.com/start?ticket=secret',
      createReactNativeAbortSignal(),
    )

    expect(calls).toEqual([
      'omit:manual:https://img.example.com/start?ticket=secret',
      'omit:manual:https://cdn.example.net/chart.png',
    ])
    expect(resolved).toMatchObject({
      height: 180,
      mimeType: 'image/png',
      sizeBytes: 24,
      uri: 'file:///private/cache/chart.png',
      width: 320,
    })
    await resolved.release()
    await resolved.release()
    expect(store.files[0]?.deleted).toBe(1)
  })

  test('不安全 redirect、错误 MIME/签名和超大像素都清理或拒绝', async () => {
    const redirect = queuedFetcher([response({
      body: stream(),
      headers: { location: 'http://cdn.example.net/chart.png' },
      status: 302,
    })])
    await expect(new BoundedInboxImageSourceResolver(
      redirect.fetcher,
      new FakeCacheStore(),
    ).resolve('https://img.example.com/start', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_source_not_allowed' })

    const unsafeFinal = queuedFetcher([response({
      headers: { 'content-type': 'image/png' },
      url: 'https://127.0.0.1/chart.png',
    })])
    const unsafeFinalStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      unsafeFinal.fetcher,
      unsafeFinalStore,
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_source_not_allowed' })
    expect(unsafeFinalStore.files).toHaveLength(0)

    const wrongMime = queuedFetcher([response({ headers: { 'content-type': 'image/gif' } })])
    const mimeStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      wrongMime.fetcher,
      mimeStore,
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_mime_not_allowed' })
    expect(mimeStore.files).toHaveLength(0)

    const badSignature = queuedFetcher([response({
      body: stream([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
      headers: { 'content-type': 'image/png' },
    })])
    const signatureStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      badSignature.fetcher,
      signatureStore,
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_content_invalid' })
    expect(signatureStore.files[0]?.deleted).toBe(1)

    const hugeDimensions = queuedFetcher([response({
      body: stream(png(4097, 100)),
      headers: { 'content-type': 'image/png' },
    })])
    const dimensionStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      hugeDimensions.fetcher,
      dimensionStore,
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_dimensions_rejected' })
    expect(dimensionStore.files[0]?.deleted).toBe(1)
  })

  test('声明和实际字节超过上限时分别在写入前与流式读取中拒绝', async () => {
    const declared = queuedFetcher([response({
      headers: { 'content-length': '25', 'content-type': 'image/png' },
    })])
    const declaredStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      declared.fetcher,
      declaredStore,
      { maxBytes: 24 },
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_too_large' })
    expect(declaredStore.files).toHaveLength(0)

    const actual = queuedFetcher([response({
      body: stream(png(320, 180), [0]),
      headers: { 'content-type': 'image/png' },
    })])
    const actualStore = new FakeCacheStore()
    await expect(new BoundedInboxImageSourceResolver(
      actual.fetcher,
      actualStore,
      { maxBytes: 24 },
    ).resolve('https://img.example.com/chart', new AbortController().signal))
      .rejects.toMatchObject({ code: 'image_too_large' })
    expect(actualStore.files[0]?.deleted).toBe(1)
  })
})
