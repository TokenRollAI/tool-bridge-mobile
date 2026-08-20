import * as Crypto from 'expo-crypto'

import { throwIfSignalAborted } from '@/capabilities/abortSignal'
import { ToolExecutionError } from '@/capabilities/types'

import type { AttentionFlashAdapter } from './flashAdapter'
import type { AttentionHapticsAdapter } from './hapticsAdapter'
import type { RingArguments, RingResult, StopResult } from './schema'
import type { AttentionSoundAdapter } from './soundAdapter'

type ActiveAttentionSession = Readonly<{
  abortSignal: AbortSignal
  abortListener: () => void
  callerSubjectId: string
  expiresAt: string
  flashStarted: boolean
  interval: ReturnType<typeof setInterval> | null
  sessionId: string
  soundStarted: boolean
  timeout: ReturnType<typeof setTimeout>
  vibrationStarted: boolean
}>

export type AttentionSessionSnapshot = Readonly<{
  callerSubjectId: string
  expiresAt: string
  remainingSeconds: number
  sessionId: string
}>

type AttentionControllerOptions = Readonly<{
  clock?: () => Date
  flash?: AttentionFlashAdapter
  idGenerator?: () => string
  pulseIntervalMs?: number
  sound?: AttentionSoundAdapter
}>

export class AttentionSessionController {
  readonly #clock: () => Date
  readonly #flash: AttentionFlashAdapter | null
  readonly #idGenerator: () => string
  readonly #pulseIntervalMs: number
  readonly #sound: AttentionSoundAdapter | null
  readonly #listeners = new Set<() => void>()
  #active: ActiveAttentionSession | null = null

  constructor(
    private readonly haptics: AttentionHapticsAdapter,
    options: AttentionControllerOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#flash = options.flash ?? null
    this.#idGenerator = options.idGenerator ?? Crypto.randomUUID
    this.#pulseIntervalMs = options.pulseIntervalMs ?? 1_500
    this.#sound = options.sound ?? null
  }

  async probeChannels(): Promise<Readonly<{ flash: boolean; haptics: boolean; sound: boolean }>> {
    const [haptics, sound, flash] = await Promise.all([
      this.haptics.probe().catch(() => false),
      this.#sound?.probe().catch(() => false) ?? Promise.resolve(false),
      this.#flash?.probe().catch(() => false) ?? Promise.resolve(false),
    ])
    return { flash, haptics, sound }
  }

  getActiveSession(): AttentionSessionSnapshot | null {
    const active = this.#active
    return active === null ? null : {
      callerSubjectId: active.callerSubjectId,
      expiresAt: active.expiresAt,
      remainingSeconds: Math.max(
        0,
        Math.ceil((Date.parse(active.expiresAt) - this.#clock().getTime()) / 1_000),
      ),
      sessionId: active.sessionId,
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async start(
    argumentsValue: RingArguments,
    callerSubjectId: string,
    signal: AbortSignal,
    commandExpiresAt?: string,
  ): Promise<RingResult> {
    if (this.#active !== null) {
      throw new ToolExecutionError(
        'attention_active',
        '已有 attention session，必须先停止后再开始',
        false,
      )
    }
    throwIfSignalAborted(signal)
    this.#throwIfExpired(commandExpiresAt)
    const available = await this.probeChannels()
    let soundStarted = false
    let vibrationStarted = false
    let flashStarted = false
    if (available.sound && this.#sound !== null) soundStarted = await this.#sound.start()
    if (argumentsValue.vibrate && available.haptics) vibrationStarted = await this.haptics.pulse()
    if (argumentsValue.flash && available.flash && this.#flash !== null) {
      flashStarted = await this.#flash.enable()
    }
    if (!soundStarted && !vibrationStarted && !flashStarted) {
      throw new ToolExecutionError('unavailable', '设备没有可执行的 attention channel', false)
    }
    if (signal.aborted || this.#isExpired(commandExpiresAt)) {
      await Promise.allSettled([
        soundStarted ? this.#sound?.stop() : Promise.resolve(),
        vibrationStarted ? this.haptics.cancel() : Promise.resolve(),
        flashStarted ? this.#flash?.disable() : Promise.resolve(),
      ])
      throwIfSignalAborted(signal)
      this.#throwIfExpired(commandExpiresAt)
    }

    const sessionId = `attention_${this.#idGenerator()}`
    const now = this.#clock().getTime()
    const durationDeadline = now + argumentsValue.durationSeconds * 1_000
    const commandDeadline = commandExpiresAt === undefined
      ? durationDeadline
      : Date.parse(commandExpiresAt)
    const expiresAtMs = Math.min(durationDeadline, commandDeadline)
    const expiresAt = new Date(expiresAtMs).toISOString()
    const remainingMs = Math.max(0, expiresAtMs - now)
    const abortListener = () => {
      void this.stop(sessionId).catch(() => undefined)
    }
    const interval = vibrationStarted ? setInterval(() => {
      void this.haptics.pulse().then(pulsed => {
        if (pulsed) this.#notify()
        else void this.stop(sessionId).catch(() => undefined)
      }).catch(() => this.stop(sessionId).catch(() => undefined))
    }, this.#pulseIntervalMs) : null
    const timeout = setTimeout(() => {
      void this.stop(sessionId).catch(() => undefined)
    }, remainingMs)
    signal.addEventListener('abort', abortListener, { once: true })
    this.#active = {
      abortListener,
      abortSignal: signal,
      callerSubjectId,
      expiresAt,
      flashStarted,
      interval,
      sessionId,
      soundStarted,
      timeout,
      vibrationStarted,
    }
    this.#notify()

    return {
      channels: {
        flash: flashStarted
          ? { status: 'requested' }
          : {
              reason: argumentsValue.flash ? 'flash_unavailable' : 'not_requested',
              status: 'unavailable',
            },
        sound: soundStarted
          ? { status: 'requested' }
          : { reason: 'sound_unavailable', status: 'unavailable' },
        vibration: vibrationStarted
          ? { status: 'requested' }
          : { reason: argumentsValue.vibrate ? 'haptics_unavailable' : 'not_requested', status: 'unavailable' },
      },
      expiresAt,
      sessionId,
    }
  }

  async stop(sessionId?: string): Promise<StopResult> {
    const active = this.#active
    if (active === null || (sessionId !== undefined && sessionId !== active.sessionId)) {
      return { sessionId: sessionId ?? null, status: 'not_active' }
    }
    this.#active = null
    this.#notify()
    if (active.interval !== null) clearInterval(active.interval)
    clearTimeout(active.timeout)
    active.abortSignal.removeEventListener('abort', active.abortListener)
    await Promise.allSettled([
      active.soundStarted ? this.#sound?.stop() : Promise.resolve(),
      active.vibrationStarted ? this.haptics.cancel() : Promise.resolve(),
      active.flashStarted ? this.#flash?.disable() : Promise.resolve(),
    ])
    return { sessionId: active.sessionId, status: 'stopped' }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #isExpired(commandExpiresAt: string | undefined): boolean {
    return commandExpiresAt !== undefined
      && Date.parse(commandExpiresAt) <= this.#clock().getTime()
  }

  #throwIfExpired(commandExpiresAt: string | undefined): void {
    if (this.#isExpired(commandExpiresAt)) {
      throw new ToolExecutionError('expired', 'attention 命令已过期', false)
    }
  }
}
