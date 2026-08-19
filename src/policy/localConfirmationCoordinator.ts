import type { CapabilityDescriptor, ConfirmationDetail } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

export type ConfirmationResolution =
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'disabled'
  | 'queue_full'

export type PendingConfirmationSnapshot = Readonly<{
  callerDisplayName: string | null
  callerSubjectId: string
  commandId: string
  description: string
  details: readonly ConfirmationDetail[]
  effect: CapabilityDescriptor['effect']
  expiresAt: string
  path: string
  risk: CapabilityDescriptor['risk']
  tool: string
}>

type PendingConfirmation = Readonly<{
  abortListener: () => void
  abortSignal: AbortSignal
  resolve: (resolution: ConfirmationResolution) => void
  snapshot: PendingConfirmationSnapshot
  timeout: ReturnType<typeof setTimeout>
}>

type LocalConfirmationOptions = Readonly<{
  clock?: () => Date
  maximumPending?: number
}>

export class LocalConfirmationCoordinator {
  readonly #clock: () => Date
  readonly #listeners = new Set<() => void>()
  readonly #maximumPending: number
  readonly #pending = new Map<string, PendingConfirmation>()
  readonly #promises = new Map<string, Promise<ConfirmationResolution>>()

  constructor(options: LocalConfirmationOptions = {}) {
    this.#clock = options.clock ?? (() => new Date())
    this.#maximumPending = options.maximumPending ?? 10
  }

  approve(commandId: string): boolean {
    return this.#settle(commandId, 'approved')
  }

  getPending(): readonly PendingConfirmationSnapshot[] {
    return [...this.#pending.values()].map(item => item.snapshot)
  }

  reject(commandId: string): boolean {
    return this.#settle(commandId, 'rejected')
  }

  rejectAll(resolution: Extract<ConfirmationResolution, 'disabled' | 'rejected'>): void {
    for (const commandId of [...this.#pending.keys()]) this.#settle(commandId, resolution)
  }

  request(
    command: LocalCommand,
    descriptor: CapabilityDescriptor,
    details: readonly ConfirmationDetail[],
    signal: AbortSignal,
  ): Promise<ConfirmationResolution> {
    const existing = this.#promises.get(command.commandId)
    if (existing !== undefined) return existing
    if (this.#pending.size >= this.#maximumPending) return Promise.resolve('queue_full')
    if (signal.aborted) return Promise.resolve('cancelled')

    const remainingMs = Date.parse(command.expiresAt) - this.#clock().getTime()
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return Promise.resolve('expired')

    const promise = new Promise<ConfirmationResolution>(resolve => {
      const abortListener = () => { this.#settle(command.commandId, 'cancelled') }
      const timeout = setTimeout(() => {
        this.#settle(command.commandId, 'expired')
      }, Math.min(remainingMs, 2_147_483_647))
      this.#pending.set(command.commandId, {
        abortListener,
        abortSignal: signal,
        resolve,
        snapshot: {
          callerDisplayName: command.caller.displayName ?? null,
          callerSubjectId: command.caller.subjectId,
          commandId: command.commandId,
          description: descriptor.description,
          details,
          effect: descriptor.effect,
          expiresAt: command.expiresAt,
          path: descriptor.path,
          risk: descriptor.risk,
          tool: descriptor.tool,
        },
        timeout,
      })
      signal.addEventListener('abort', abortListener, { once: true })
    })
    this.#promises.set(command.commandId, promise)
    this.#notify()
    return promise
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #settle(commandId: string, resolution: ConfirmationResolution): boolean {
    const pending = this.#pending.get(commandId)
    if (pending === undefined) return false
    this.#pending.delete(commandId)
    this.#promises.delete(commandId)
    clearTimeout(pending.timeout)
    pending.abortSignal.removeEventListener('abort', pending.abortListener)
    pending.resolve(resolution)
    this.#notify()
    return true
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
