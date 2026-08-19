import {
  createAudioPlayer,
  setAudioModeAsync,
} from 'expo-audio'

import { ToolExecutionError } from '@/capabilities/types'

import type {
  MediaPlaybackPort,
  MediaPlaybackPortFactory,
  MediaPlaybackRequest,
  MediaPlaybackStatus,
} from './playbackPort'
import type {
  AudioPlayer,
  AudioStatus,
} from 'expo-audio'

const MEDIA_METADATA_TIMEOUT_MS = 10_000

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function mapStatus(status: AudioStatus): MediaPlaybackStatus {
  let state: MediaPlaybackStatus['state']
  if (status.error !== null) state = 'failed'
  else if (status.mediaServicesDidReset === true) state = 'interrupted'
  else if (status.didJustFinish) state = 'stopped'
  else if (status.playing) state = 'playing'
  else if (!status.isLoaded || status.isBuffering) state = 'loading'
  else state = 'paused'

  return {
    currentTimeSeconds: finiteNonNegative(status.currentTime),
    durationSeconds: status.duration > 0 && Number.isFinite(status.duration)
      ? status.duration
      : null,
    state,
  }
}

export class ExpoAudioPlaybackPort implements MediaPlaybackPort {
  #player: AudioPlayer | null = null
  #rejectStartup: ((error: ToolExecutionError) => void) | null = null
  #subscription: ReturnType<AudioPlayer['addListener']> | null = null

  async pause(): Promise<void> {
    const player = this.#requirePlayer()
    try {
      player.pause()
    } catch {
      throw this.#nativeFailure('暂停')
    }
  }

  async resume(): Promise<void> {
    const player = this.#requirePlayer()
    try {
      player.play()
    } catch {
      throw this.#nativeFailure('继续')
    }
  }

  async start(
    request: MediaPlaybackRequest,
    onStatus: (status: MediaPlaybackStatus) => void,
  ): Promise<void> {
    if (this.#player !== null) {
      throw new ToolExecutionError('media_active', '媒体 port 已有活动 player', false)
    }
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      })
      const player = createAudioPlayer(request.url, {
        downloadFirst: false,
        updateInterval: 500,
      })
      this.#player = player
      let ready = false
      const loadedStatus = await new Promise<AudioStatus>((resolve, reject) => {
        let settled = false
        const finish = (result: Readonly<{ error: ToolExecutionError } | { status: AudioStatus }>) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          request.signal.removeEventListener('abort', cancel)
          if (this.#rejectStartup === rejectStartup) this.#rejectStartup = null
          if ('error' in result) reject(result.error)
          else resolve(result.status)
        }
        const cancel = () => finish({
          error: new ToolExecutionError('cancelled', '媒体播放启动已取消', false),
        })
        const rejectStartup = (error: ToolExecutionError) => finish({ error })
        const inspect = (status: AudioStatus) => {
          if (ready) {
            onStatus(mapStatus(status))
            return
          }
          if (status.error !== null) {
            finish({ error: this.#nativeFailure('读取媒体') })
          } else if (status.isLive) {
            finish({
              error: new ToolExecutionError(
                'media_duration_not_allowed',
                '不接受无法确定时长的直播媒体',
                false,
              ),
            })
          } else if (status.isLoaded) {
            if (!Number.isFinite(status.duration) || status.duration <= 0) {
              finish({
                error: new ToolExecutionError(
                  'media_duration_invalid',
                  '媒体时长无效',
                  false,
                ),
              })
            } else if (status.duration > request.maxDurationSeconds) {
              finish({
                error: new ToolExecutionError(
                  'media_duration_not_allowed',
                  '媒体时长超过本地上限',
                  false,
                ),
              })
            } else {
              finish({ status })
            }
          }
        }
        const timeout = setTimeout(() => finish({
          error: new ToolExecutionError('media_metadata_timeout', '读取媒体时长超过本地时限', true),
        }), MEDIA_METADATA_TIMEOUT_MS)
        this.#rejectStartup = rejectStartup
        request.signal.addEventListener('abort', cancel, { once: true })
        this.#subscription = player.addListener('playbackStatusUpdate', inspect)
        inspect(player.currentStatus)
      })
      if (request.signal.aborted) {
        throw new ToolExecutionError('cancelled', '媒体播放启动已取消', false)
      }
      ready = true
      onStatus(mapStatus(loadedStatus))
      player.setActiveForLockScreen(true, {
        artist: `调用方 ${request.callerSubjectId}`,
        title: `Tool Bridge · ${request.title}`,
      }, {
        showSeekBackward: false,
        showSeekForward: false,
      })
      onStatus(mapStatus(player.currentStatus))
      player.play()
    } catch (error) {
      await this.#release()
      if (error instanceof ToolExecutionError) throw error
      throw this.#nativeFailure('启动')
    }
  }

  async stop(): Promise<void> {
    this.#rejectStartup?.(
      new ToolExecutionError('cancelled', '媒体播放启动已停止', false),
    )
    this.#rejectStartup = null
    const player = this.#player
    if (player === null) return
    this.#player = null
    this.#subscription?.remove()
    this.#subscription = null
    try {
      player.pause()
      player.clearLockScreenControls()
      await player.seekTo(0)
      player.remove()
    } catch {
      try {
        player.remove()
      } catch {
        // player 引用已经移除；错误统一映射，不能泄露 native detail。
      }
      throw this.#nativeFailure('停止')
    }
  }

  #nativeFailure(operation: string): ToolExecutionError {
    return new ToolExecutionError('native_failure', `媒体原生模块${operation}失败`, false)
  }

  async #release(): Promise<void> {
    try {
      await this.stop()
    } catch {
      // start 的调用方只接收一个稳定失败结果。
    }
  }

  #requirePlayer(): AudioPlayer {
    if (this.#player === null) {
      throw new ToolExecutionError('not_found', '没有活动媒体 player', false)
    }
    return this.#player
  }
}

export class ExpoAudioPlaybackPortFactory implements MediaPlaybackPortFactory {
  #probeResult: Promise<boolean> | null = null

  create(): MediaPlaybackPort {
    return new ExpoAudioPlaybackPort()
  }

  probe(): Promise<boolean> {
    this.#probeResult ??= Promise.resolve().then(() => {
      try {
        const player = createAudioPlayer(null)
        player.remove()
        return true
      } catch {
        return false
      }
    })
    return this.#probeResult
  }
}
