import * as Crypto from 'expo-crypto'

import { ToolExecutionError } from '@/capabilities/types'

import { validateAllowedMediaSource } from './sourcePolicy'

import type {
  MediaPlaybackPort,
  MediaPlaybackPortFactory,
  MediaPlaybackState,
  MediaPlaybackStatus,
} from './playbackPort'
import type { MediaPlayArguments } from './schema'
import type { MediaSourceResolver, ResolvedMediaSource } from './sourceResolver'

export const MAX_MEDIA_DURATION_SECONDS = 2 * 60 * 60

export type MediaSessionSnapshot = Readonly<{
  artist: string | null
  callerSubjectId: string
  currentTimeSeconds: number
  durationSeconds: number | null
  mimeType: string
  sessionId: string
  sizeBytes: number
  sourceHost: string
  state: MediaPlaybackState
  title: string
}>

type ActiveMediaSession = Readonly<{
  abortListener: () => void
  abortSignal: AbortSignal
  port: MediaPlaybackPort
  source: ResolvedMediaSource
  snapshot: MediaSessionSnapshot
}>

type MediaControllerOptions = Readonly<{
  idGenerator?: () => string
}>

const ACTIVE_STATES = new Set<MediaPlaybackState>([
  'interrupted',
  'loading',
  'paused',
  'playing',
])

export class MediaSessionController {
  readonly #idGenerator: () => string
  readonly #listeners = new Set<() => void>()
  #active: ActiveMediaSession | null = null
  #lastSnapshot: MediaSessionSnapshot | null = null
  #starting = false

  constructor(
    private readonly portFactory: MediaPlaybackPortFactory,
    private readonly allowedHosts: ReadonlySet<string>,
    private readonly sourceResolver: MediaSourceResolver,
    options: MediaControllerOptions = {},
  ) {
    this.#idGenerator = options.idGenerator ?? Crypto.randomUUID
  }

  getSession(): MediaSessionSnapshot | null {
    return this.#active?.snapshot ?? this.#lastSnapshot
  }

  validateSource(rawUrl: string): Readonly<{ host: string }> {
    return validateAllowedMediaSource(rawUrl, this.allowedHosts)
  }

  hasConfiguredSource(): boolean {
    return this.allowedHosts.size > 0
  }

  probePlayback(): Promise<boolean> {
    return this.portFactory.probe()
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async play(
    argumentsValue: MediaPlayArguments,
    callerSubjectId: string,
    signal: AbortSignal,
  ): Promise<MediaSessionSnapshot> {
    if (
      this.#starting
      || (this.#active !== null && ACTIVE_STATES.has(this.#active.snapshot.state))
    ) {
      throw new ToolExecutionError(
        'media_active',
        '已有媒体会话，必须先停止后再播放',
        false,
      )
    }
    signal.throwIfAborted()
    const source = validateAllowedMediaSource(argumentsValue.source.url, this.allowedHosts)
    if (!await this.portFactory.probe()) {
      throw new ToolExecutionError('unavailable', '设备音频播放模块不可用', false)
    }
    signal.throwIfAborted()

    this.#starting = true
    let resolvedSource: ResolvedMediaSource | null = null
    let sessionId: string | null = null
    try {
      resolvedSource = await this.sourceResolver.resolve(source.url, this.allowedHosts, signal)
      signal.throwIfAborted()
      const port = this.portFactory.create()
      const createdSessionId = `media_${this.#idGenerator()}`
      sessionId = createdSessionId
      const abortListener = () => {
        void this.stop(createdSessionId).catch(() => undefined)
      }
      const snapshot: MediaSessionSnapshot = {
        artist: argumentsValue.artist ?? null,
        callerSubjectId,
        currentTimeSeconds: 0,
        durationSeconds: null,
        mimeType: resolvedSource.mimeType,
        sessionId: createdSessionId,
        sizeBytes: resolvedSource.sizeBytes,
        sourceHost: source.host,
        state: 'loading',
        title: argumentsValue.title,
      }
      this.#active = {
        abortListener,
        abortSignal: signal,
        port,
        snapshot,
        source: resolvedSource,
      }
      signal.addEventListener('abort', abortListener, { once: true })
      this.#notify()
      await port.start({
        ...(argumentsValue.artist === undefined ? {} : { artist: argumentsValue.artist }),
        callerSubjectId,
        maxDurationSeconds: MAX_MEDIA_DURATION_SECONDS,
        signal,
        title: argumentsValue.title,
        url: resolvedSource.uri,
      }, status => this.#receiveStatus(createdSessionId, status))
      signal.throwIfAborted()
      return this.#requireSession(createdSessionId).snapshot
    } catch (error) {
      if (sessionId !== null) await this.#finish(sessionId, 'failed')
      else await resolvedSource?.release().catch(() => undefined)
      if (error instanceof ToolExecutionError) throw error
      if (signal.aborted) throw error
      throw new ToolExecutionError('native_failure', '媒体播放启动失败', false)
    } finally {
      this.#starting = false
    }
  }

  async pause(sessionId: string): Promise<MediaSessionSnapshot> {
    const active = this.#requireSession(sessionId)
    if (active.snapshot.state !== 'playing' && active.snapshot.state !== 'loading') {
      throw new ToolExecutionError('invalid_state', '媒体会话当前不能暂停', false)
    }
    await active.port.pause()
    this.#replaceSnapshot(active, { state: 'paused' })
    return this.#requireSession(sessionId).snapshot
  }

  async resume(sessionId: string): Promise<MediaSessionSnapshot> {
    const active = this.#requireSession(sessionId)
    if (active.snapshot.state !== 'paused' && active.snapshot.state !== 'interrupted') {
      throw new ToolExecutionError('invalid_state', '媒体会话当前不能继续', false)
    }
    await active.port.resume()
    this.#replaceSnapshot(active, { state: 'playing' })
    return this.#requireSession(sessionId).snapshot
  }

  async stop(sessionId?: string): Promise<MediaSessionSnapshot | null> {
    const active = this.#active
    if (active === null) {
      if (sessionId === undefined) return this.#lastSnapshot
      if (this.#lastSnapshot?.sessionId === sessionId) return this.#lastSnapshot
      throw new ToolExecutionError('not_found', '指定媒体会话不存在', false)
    }
    if (sessionId !== undefined && active.snapshot.sessionId !== sessionId) {
      throw new ToolExecutionError('not_found', '指定媒体会话不存在', false)
    }
    await this.#finish(active.snapshot.sessionId, 'stopped')
    return this.#lastSnapshot
  }

  status(sessionId: string): MediaSessionSnapshot {
    if (this.#active?.snapshot.sessionId === sessionId) return this.#active.snapshot
    if (this.#lastSnapshot?.sessionId === sessionId) return this.#lastSnapshot
    throw new ToolExecutionError('not_found', '指定媒体会话不存在', false)
  }

  async #finish(sessionId: string, state: MediaPlaybackState): Promise<void> {
    const active = this.#active
    if (active === null || active.snapshot.sessionId !== sessionId) return
    this.#active = null
    active.abortSignal.removeEventListener('abort', active.abortListener)
    this.#lastSnapshot = { ...active.snapshot, state }
    this.#notify()
    let stopError: unknown = null
    try {
      await active.port.stop()
    } catch (error) {
      stopError = error
    }
    try {
      await active.source.release()
    } catch (error) {
      stopError ??= error
    }
    this.#notify()
    if (stopError !== null) throw stopError
  }

  #receiveStatus(sessionId: string, status: MediaPlaybackStatus): void {
    const active = this.#active
    if (active === null || active.snapshot.sessionId !== sessionId) return
    this.#replaceSnapshot(active, status)
    if (status.state === 'failed' || status.state === 'stopped') {
      void this.#finish(sessionId, status.state).catch(() => undefined)
    }
  }

  #replaceSnapshot(
    active: ActiveMediaSession,
    update: Partial<Pick<MediaSessionSnapshot, 'currentTimeSeconds' | 'durationSeconds' | 'state'>>,
  ): void {
    if (this.#active !== active) return
    this.#active = { ...active, snapshot: { ...active.snapshot, ...update } }
    this.#notify()
  }

  #requireSession(sessionId: string): ActiveMediaSession {
    const active = this.#active
    if (active === null || active.snapshot.sessionId !== sessionId) {
      throw new ToolExecutionError('not_found', '指定媒体会话不在运行', false)
    }
    return active
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
