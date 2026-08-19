import { ToolExecutionError } from '@/capabilities/types'

import type {
  LocalNotificationAdapter,
  NotificationAuthorization,
} from './notificationAdapter'
import type { LocalNotificationArguments } from './notificationSchema'
import type { CapabilityAvailability, CapabilityInvocation } from '@/capabilities/types'

export type LocalNotificationResult = Readonly<{
  notificationId: string
  presentation: 'system_determined'
  scheduledAt: string
  status: 'scheduled'
}>

type PendingBoundary = Readonly<{
  expiresAt?: string
  signal?: AbortSignal
}>

const NATIVE_OPERATION_TIMEOUT_MS = 5_000
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000
const SAFE_NATIVE_IDENTIFIER = /^tb_local_notify_[a-f0-9]{64}$/

export class LocalNotificationController {
  #initializationFailed = false

  constructor(
    private readonly adapter: LocalNotificationAdapter,
    private readonly clock: () => Date = () => new Date(),
    private readonly nativeOperationTimeoutMs = NATIVE_OPERATION_TIMEOUT_MS,
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.#bounded(this.adapter.initialize(), {}, 'notification_initialization_timeout')
      this.#initializationFailed = false
    } catch {
      this.#initializationFailed = true
    }
  }

  async probe(appState: string): Promise<CapabilityAvailability> {
    if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
    if (this.#initializationFailed) {
      return { reason: 'notification_initialization_failed', status: 'unavailable' }
    }
    try {
      return this.#availability(await this.#bounded(
        this.adapter.getAuthorization(),
        {},
        'notification_probe_timeout',
      ))
    } catch (error) {
      const reason = error instanceof ToolExecutionError
        ? error.code
        : 'notification_probe_failed'
      return { reason, status: 'unavailable' }
    }
  }

  async requestPermission(): Promise<NotificationAuthorization> {
    await this.#bounded(
      this.adapter.initialize(),
      {},
      'notification_initialization_timeout',
    )
    this.#initializationFailed = false
    return this.#bounded(
      this.adapter.requestAuthorization(),
      {},
      'notification_permission_request_timeout',
      PERMISSION_REQUEST_TIMEOUT_MS,
    )
  }

  async notify(
    argumentsValue: LocalNotificationArguments,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<LocalNotificationResult> {
    this.#assertMayCommit(signal, invocation.expiresAt)
    const authorization = await this.#bounded(
      this.adapter.getAuthorization(),
      { expiresAt: invocation.expiresAt, signal },
      'notification_probe_timeout',
    )
    const availability = this.#availability(authorization)
    if (availability.status !== 'available') {
      throw new ToolExecutionError(
        availability.status === 'permission_required' ? availability.reason : 'notification_unavailable',
        '当前系统通知授权或 channel 不可用',
        false,
      )
    }
    this.#assertMayCommit(signal, invocation.expiresAt)

    let notificationId: string
    try {
      notificationId = await this.#boundedAfterCommit(
        this.adapter.schedule({
          commandId: invocation.commandId,
          message: argumentsValue.message,
        }),
      )
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error
      throw new ToolExecutionError(
        'notification_status_unknown',
        '系统未能确认本地通知调度结果',
        false,
      )
    }
    if (!SAFE_NATIVE_IDENTIFIER.test(notificationId)) {
      throw new ToolExecutionError(
        'notification_status_unknown',
        '系统返回了无效的本地通知标识',
        false,
      )
    }
    return {
      notificationId,
      presentation: 'system_determined',
      scheduledAt: this.clock().toISOString(),
      status: 'scheduled',
    }
  }

  #availability(authorization: NotificationAuthorization): CapabilityAvailability {
    switch (authorization.status) {
      case 'granted': return { status: 'available' }
      case 'requestable': return {
        reason: 'notification_permission_requestable',
        status: 'unavailable',
      }
      case 'denied': return { reason: 'notification_permission_denied', status: 'unavailable' }
      case 'channel_disabled': return { reason: 'notification_channel_disabled', status: 'unavailable' }
      case 'unavailable': return { reason: authorization.reason, status: 'unavailable' }
    }
  }

  async #bounded<T>(
    operation: Promise<T>,
    boundary: PendingBoundary,
    timeoutCode: string,
    timeoutMs = this.nativeOperationTimeoutMs,
  ): Promise<T> {
    const { expiresAt, signal } = boundary
    if (signal?.aborted === true) throw this.#cancelled()
    const deadlineMs = expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(expiresAt)
    if (deadlineMs <= this.clock().getTime()) throw this.#expired()

    const remainingDeadlineMs = deadlineMs - this.clock().getTime()
    const waitMs = Math.min(timeoutMs, remainingDeadlineMs)
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => { finish(() => reject(this.#cancelled())) }
      const timer = setTimeout(() => {
        const expired = expiresAt !== undefined && Date.parse(expiresAt) <= this.clock().getTime()
        finish(() => reject(expired ? this.#expired() : new ToolExecutionError(
          timeoutCode,
          '系统通知操作超时',
          true,
        )))
      }, Math.max(0, waitMs))
      signal?.addEventListener('abort', onAbort, { once: true })
      operation.then(
        value => { finish(() => resolve(value)) },
        error => { finish(() => reject(error)) },
      )
    })
  }

  async #boundedAfterCommit<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        finish(() => reject(new ToolExecutionError(
          'notification_status_unknown',
          '系统未在时限内确认本地通知调度结果',
          false,
        )))
      }, this.nativeOperationTimeoutMs)
      operation.then(
        value => { finish(() => resolve(value)) },
        error => { finish(() => reject(error)) },
      )
    })
  }

  #assertMayCommit(signal: AbortSignal, expiresAt: string): void {
    if (signal.aborted) throw this.#cancelled()
    if (Date.parse(expiresAt) <= this.clock().getTime()) throw this.#expired()
  }

  #cancelled(): ToolExecutionError {
    return new ToolExecutionError('cancelled', '命令已取消', false)
  }

  #expired(): ToolExecutionError {
    return new ToolExecutionError('expired', '命令已过期', false)
  }
}
