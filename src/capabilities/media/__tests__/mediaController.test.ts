import { createReactNativeAbortSignal } from '@/testFixtures/reactNativeAbortSignal'

import { MediaSessionController } from '../controller'
import { mediaPlayArgumentsSchema } from '../schema'

import type {
  MediaPlaybackPort,
  MediaPlaybackPortFactory,
  MediaPlaybackRequest,
  MediaPlaybackStatus,
} from '../playbackPort'
import type { MediaSourceResolver } from '../sourceResolver'

class FakeMediaPort implements MediaPlaybackPort {
  onStatus: ((status: MediaPlaybackStatus) => void) | null = null
  pauses = 0
  request: MediaPlaybackRequest | null = null
  resumes = 0
  seeks: number[] = []
  starts = 0
  stops = 0

  async pause(): Promise<void> {
    this.pauses += 1
    this.onStatus?.({ currentTimeSeconds: 3, durationSeconds: 30, state: 'paused' })
  }

  async resume(): Promise<void> {
    this.resumes += 1
    this.onStatus?.({ currentTimeSeconds: 3, durationSeconds: 30, state: 'playing' })
  }

  async seek(positionSeconds: number): Promise<void> {
    this.seeks.push(positionSeconds)
    this.onStatus?.({ currentTimeSeconds: positionSeconds, durationSeconds: 30, state: 'playing' })
  }

  async start(
    request: MediaPlaybackRequest,
    onStatus: (status: MediaPlaybackStatus) => void,
  ): Promise<void> {
    this.starts += 1
    this.request = request
    this.onStatus = onStatus
    onStatus({ currentTimeSeconds: 0, durationSeconds: 30, state: 'playing' })
  }

  async stop(): Promise<void> {
    this.stops += 1
  }
}

class FakeMediaPortFactory implements MediaPlaybackPortFactory {
  readonly ports: FakeMediaPort[] = []

  create(): MediaPlaybackPort {
    const port = new FakeMediaPort()
    this.ports.push(port)
    return port
  }

  async probe(): Promise<boolean> {
    return true
  }
}

class FakeMediaSourceResolver implements MediaSourceResolver {
  releases = 0

  async resolve() {
    return {
      mimeType: 'audio/mpeg',
      release: async () => { this.releases += 1 },
      sizeBytes: 1_024,
      uri: 'file:///private/cache/fixture.mp3',
    }
  }
}

const playArguments = mediaPlayArgumentsSchema.parse({
  artist: 'Fixture Artist',
  source: { kind: 'https', url: 'https://media.example.com/private.mp3?ticket=secret' },
  title: 'Fixture Track',
})

function createController() {
  const factory = new FakeMediaPortFactory()
  const resolver = new FakeMediaSourceResolver()
  const controller = new MediaSessionController(
    factory,
    new Set(['media.example.com']),
    resolver,
    { idGenerator: () => 'fixture-session' },
  )
  return { controller, factory, resolver }
}

describe('MediaSessionController', () => {
  test('play/pause/resume/seek/stop 使用同一会话且快照不泄露完整 URL', async () => {
    const { controller, factory, resolver } = createController()
    const signal = createReactNativeAbortSignal()
    const session = await controller.play(
      playArguments,
      'caller_a',
      signal,
    )

    expect(session).toMatchObject({
      callerSubjectId: 'caller_a',
      mimeType: 'audio/mpeg',
      sessionId: 'media_fixture-session',
      sizeBytes: 1_024,
      sourceHost: 'media.example.com',
      state: 'playing',
    })
    expect(factory.ports[0]?.request).toMatchObject({ callerSubjectId: 'caller_a' })
    expect(factory.ports[0]?.request?.maxDurationSeconds).toBe(7_200)
    expect(factory.ports[0]?.request?.signal).toBe(signal)
    expect('throwIfAborted' in signal).toBe(false)
    expect(factory.ports[0]?.request?.url).toBe('file:///private/cache/fixture.mp3')
    expect(JSON.stringify(session)).not.toContain('ticket=secret')
    await expect(controller.pause(session.sessionId)).resolves.toMatchObject({ state: 'paused' })
    await expect(controller.resume(session.sessionId)).resolves.toMatchObject({ state: 'playing' })
    await expect(controller.seek(session.sessionId, 12_500)).resolves.toMatchObject({
      currentTimeSeconds: 12.5,
    })
    await expect(controller.stop(session.sessionId)).resolves.toMatchObject({ state: 'stopped' })
    expect(factory.ports[0]).toMatchObject({
      pauses: 1,
      resumes: 1,
      seeks: [12.5],
      starts: 1,
      stops: 1,
    })
    expect(resolver.releases).toBe(1)
  })

  test('seek 拒绝超过媒体时长的位置', async () => {
    const { controller, factory } = createController()
    const session = await controller.play(
      playArguments,
      'caller_a',
      new AbortController().signal,
    )

    await expect(controller.seek(session.sessionId, 30_001)).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    expect(factory.ports[0]?.seeks).toEqual([])
    await controller.stop()
  })

  test('不同 play 在活动会话期间不能创建重叠 player', async () => {
    const { controller, factory } = createController()
    await controller.play(playArguments, 'caller_a', new AbortController().signal)

    await expect(controller.play(
      playArguments,
      'caller_b',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'media_active' })
    expect(factory.ports).toHaveLength(1)
    await controller.stop()
  })

  test('AbortSignal 立即停止活动 player', async () => {
    const { controller, factory } = createController()
    const abortController = new AbortController()
    await controller.play(playArguments, 'caller_a', abortController.signal)

    abortController.abort()
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(factory.ports[0]?.stops).toBe(1)
    expect(controller.getSession()).toMatchObject({ state: 'stopped' })
  })

  test('native 状态更新映射到可观察 session', async () => {
    const { controller, factory } = createController()
    const session = await controller.play(
      playArguments,
      'caller_a',
      new AbortController().signal,
    )
    factory.ports[0]?.onStatus?.({
      currentTimeSeconds: 8,
      durationSeconds: 30,
      state: 'interrupted',
    })

    expect(controller.status(session.sessionId)).toMatchObject({
      currentTimeSeconds: 8,
      state: 'interrupted',
    })
    await controller.stop()
  })
})
