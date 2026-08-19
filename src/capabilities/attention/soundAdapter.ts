import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { Directory, File, Paths } from 'expo-file-system'

import type { AudioPlayer } from 'expo-audio'

const SAMPLE_RATE = 8_000
const DURATION_SECONDS = 0.6
const FREQUENCY_HZ = 880

export interface AttentionSoundAdapter {
  probe(): Promise<boolean>
  start(): Promise<boolean>
  stop(): Promise<void>
}

export function createFindDeviceWaveBytes(): Uint8Array {
  const sampleCount = Math.floor(SAMPLE_RATE * DURATION_SECONDS)
  const dataSize = sampleCount * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 160, (sampleCount - index) / 160)
    const sample = Math.sin(2 * Math.PI * FREQUENCY_HZ * index / SAMPLE_RATE)
    view.setInt16(44 + index * 2, Math.round(sample * envelope * 8_000), true)
  }
  return bytes
}

export class ExpoAttentionSoundAdapter implements AttentionSoundAdapter {
  #player: AudioPlayer | null = null

  async probe(): Promise<boolean> {
    try {
      const player = createAudioPlayer(this.#ensureFile().uri)
      player.remove()
      return true
    } catch {
      return false
    }
  }

  async start(): Promise<boolean> {
    await this.stop().catch(() => undefined)
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'doNotMix',
        playsInSilentMode: false,
        shouldPlayInBackground: false,
      })
      const player = createAudioPlayer(this.#ensureFile().uri, {
        downloadFirst: false,
        updateInterval: 1_000,
      })
      player.loop = true
      player.volume = 0.65
      this.#player = player
      player.play()
      return true
    } catch {
      await this.stop().catch(() => undefined)
      return false
    }
  }

  async stop(): Promise<void> {
    const player = this.#player
    if (player === null) return
    this.#player = null
    try {
      player.pause()
      player.remove()
    } catch {
      try {
        player.remove()
      } catch {
        // 引用已经释放；调用方只接收稳定的停止结果。
      }
    }
  }

  #ensureFile(): File {
    const directory = new Directory(Paths.cache, 'tool-bridge-attention')
    directory.create({ idempotent: true, intermediates: true })
    const file = new File(directory, 'find-device-v1.wav')
    if (!file.exists) {
      file.create({ intermediates: true })
      file.write(createFindDeviceWaveBytes())
    }
    return file
  }
}
