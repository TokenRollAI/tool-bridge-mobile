import {
  createAudioPlayer,
  setAudioModeAsync,
} from 'expo-audio'

import { ExpoAudioPlaybackPort } from '../expoAudioPlaybackPort'

import type { AudioPlayer, AudioStatus } from 'expo-audio'

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}))

const createAudioPlayerMock = jest.mocked(createAudioPlayer)
const setAudioModeAsyncMock = jest.mocked(setAudioModeAsync)

function status(overrides: Partial<AudioStatus> = {}): AudioStatus {
  return {
    currentTime: 0,
    currentOffsetFromLive: null,
    didJustFinish: false,
    duration: 30,
    error: null,
    id: 'fixture-player',
    isBuffering: false,
    isLive: false,
    isLoaded: true,
    loop: false,
    mute: false,
    playbackRate: 1,
    playbackState: 'readyToPlay',
    playing: false,
    reasonForWaitingToPlay: '',
    shouldCorrectPitch: true,
    timeControlStatus: 'paused',
    ...overrides,
  }
}

function fakePlayer(initialStatus: AudioStatus) {
  let listener: ((value: AudioStatus) => void) | null = null
  const remove = jest.fn()
  const player = {
    addListener: jest.fn((_event: string, nextListener: (value: AudioStatus) => void) => {
      listener = nextListener
      return { remove }
    }),
    clearLockScreenControls: jest.fn(),
    currentStatus: initialStatus,
    pause: jest.fn(),
    play: jest.fn(),
    remove: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    setActiveForLockScreen: jest.fn(),
  } as unknown as AudioPlayer
  return {
    emit: (nextStatus: AudioStatus) => { listener?.(nextStatus) },
    player,
    remove,
  }
}

function request(signal = new AbortController().signal) {
  return {
    callerSubjectId: 'caller_a',
    maxDurationSeconds: 7_200,
    signal,
    title: 'Fixture Track',
    url: 'file:///private/cache/fixture.mp3',
  }
}

describe('ExpoAudioPlaybackPort', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setAudioModeAsyncMock.mockResolvedValue(undefined)
  })

  test('只在本地文件已加载且时长合规后开始播放', async () => {
    const fixture = fakePlayer(status({ duration: 7_200 }))
    createAudioPlayerMock.mockReturnValue(fixture.player)
    const port = new ExpoAudioPlaybackPort()

    await port.start(request(), jest.fn())

    expect(createAudioPlayerMock).toHaveBeenCalledWith(
      'file:///private/cache/fixture.mp3',
      expect.objectContaining({ downloadFirst: false }),
    )
    expect(fixture.player.setActiveForLockScreen).toHaveBeenCalledTimes(1)
    expect(fixture.player.play).toHaveBeenCalledTimes(1)
    await port.seek(12.5)
    expect(fixture.player.seekTo).toHaveBeenCalledWith(12.5)
    await port.stop()
  })

  test('超时长媒体在 play 前被拒绝并释放 player', async () => {
    const fixture = fakePlayer(status({ duration: 7_200.1 }))
    createAudioPlayerMock.mockReturnValue(fixture.player)
    const port = new ExpoAudioPlaybackPort()

    await expect(port.start(request(), jest.fn())).rejects.toMatchObject({
      code: 'media_duration_not_allowed',
    })
    expect(fixture.player.setActiveForLockScreen).not.toHaveBeenCalled()
    expect(fixture.player.play).not.toHaveBeenCalled()
    expect(fixture.player.remove).toHaveBeenCalledTimes(1)
  })

  test('直播媒体在 play 前被拒绝', async () => {
    const fixture = fakePlayer(status({ duration: 0, isLive: true }))
    createAudioPlayerMock.mockReturnValue(fixture.player)
    const port = new ExpoAudioPlaybackPort()

    await expect(port.start(request(), jest.fn())).rejects.toMatchObject({
      code: 'media_duration_not_allowed',
    })
    expect(fixture.player.play).not.toHaveBeenCalled()
  })

  test('等待 metadata 时取消不会开始播放', async () => {
    const fixture = fakePlayer(status({ duration: 0, isLoaded: false }))
    createAudioPlayerMock.mockReturnValue(fixture.player)
    const port = new ExpoAudioPlaybackPort()
    const abortController = new AbortController()
    const pending = port.start(request(abortController.signal), jest.fn())
    const rejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await new Promise<void>(resolve => { setImmediate(resolve) })

    abortController.abort()

    await rejection
    expect(fixture.player.play).not.toHaveBeenCalled()
    expect(fixture.player.remove).toHaveBeenCalledTimes(1)
  })

  test('metadata 等待有界且 timeout 不会开始播放', async () => {
    jest.useFakeTimers()
    try {
      const fixture = fakePlayer(status({ duration: 0, isLoaded: false }))
      createAudioPlayerMock.mockReturnValue(fixture.player)
      const port = new ExpoAudioPlaybackPort()
      const pending = port.start(request(), jest.fn())
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'media_metadata_timeout',
      })
      await Promise.resolve()
      await Promise.resolve()

      jest.advanceTimersByTime(10_000)

      await rejection
      expect(fixture.player.play).not.toHaveBeenCalled()
      expect(fixture.player.remove).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
