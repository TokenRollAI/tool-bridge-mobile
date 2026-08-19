import * as Crypto from 'expo-crypto'

import { ToolExecutionError } from '@/capabilities/types'

import type { AttentionHapticsAdapter } from './hapticsAdapter'
import type { RingArguments, RingResult, StopResult } from './schema'

type ActiveAttentionSession = Readonly<{
  abortSignal: AbortSignal
  abortListener: () => void
  callerSubjectId: string
  expiresAt: string
  interval: ReturnType<typeof setInterval>
  sessionId: string
  timeout: ReturnType<typeof setTimeout>
}>

export type AttentionSessionSnapshot = Readonly<{
  callerSubjectId: string
  expiresAt: string
  remainingSeconds: number
  sessionId: string
}>

type AttentionControllerOptions = Readonly<{
  clock?: () => Date
  idGenerator?: () => string
  pulseIntervalMs?: number
}>

export class AttentionSessionController {
  readonly #clock: () => Date
  readonly #idGenerator: () => string
  readonly #pulseIntervalMs: number
  readonly #listeners = new Set<() => void>()
  #active: ActiveAttentionSession | null = null

  constructor(
    private readonly haptics: AttentionHapticsAdapter,
    options: AttentionControllerOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#idGenerator = options.idGenerator ?? Crypto.randomUUID
    this.#pulseIntervalMs = options.pulseIntervalMs ?? 1_500
  }

  probeHaptics(): Promise<boolean> {
    return this.haptics.probe()
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
    signal.throwIfAborted()
    this.#throwIfExpired(commandExpiresAt)
    if (!argumentsValue.vibrate || !await this.haptics.probe()) {
      throw new ToolExecutionError('unavailable', '设备没有可探测的 haptic channel', false)
    }
    signal.throwIfAborted()
    this.#throwIfExpired(commandExpiresAt)
    if (!await this.haptics.pulse()) {
      throw new ToolExecutionError('unavailable', 'haptic channel 在执行前变为不可用', false)
    }
    if (signal.aborted || this.#isExpired(commandExpiresAt)) {
      await this.haptics.cancel()
      signal.throwIfAborted()
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
    const interval = setInterval(() => {
      void this.haptics.pulse().then(pulsed => {
        if (pulsed) this.#notify()
        else void this.stop(sessionId).catch(() => undefined)
      }).catch(() => this.stop(sessionId).catch(() => undefined))
    }, this.#pulseIntervalMs)
    const timeout = setTimeout(() => {
      void this.stop(sessionId).catch(() => undefined)
    }, remainingMs)
    signal.addEventListener('abort', abortListener, { once: true })
    this.#active = {
      abortListener,
      abortSignal: signal,
      callerSubjectId,
      expiresAt,
      interval,
      sessionId,
      timeout,
    }
    this.#notify()

    return {
      channels: {
        flash: { reason: 'flash_not_implemented', status: 'unavailable' },
        sound: { reason: 'sound_not_implemented', status: 'unavailable' },
        vibration: { status: 'requested' },
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
    clearInterval(active.interval)
    clearTimeout(active.timeout)
    active.abortSignal.removeEventListener('abort', active.abortListener)
    await this.haptics.cancel()
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
