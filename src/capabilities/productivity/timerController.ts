import { ToolExecutionError } from '@/capabilities/types'

import {
  deriveLocalTimerIdentifiers,
  isLocalTimerNotificationIdentifier,
} from './notificationAdapter'
import { isTimerId } from './timerSchema'

import type {
  LocalTimerNotificationPort,
  NotificationAuthorization,
} from './notificationAdapter'
import type { TimerStartArguments } from './timerSchema'
import type { CapabilityAvailability, CapabilityInvocation } from '@/capabilities/types'
import type {
  StoredTimer,
  TimerRepository,
  TimerState,
} from '@/storage/timerRepository'

export const TIMER_MINIMUM_LEAD_MS = 10_000
export const TIMER_MAXIMUM_LEAD_MS = 24 * 60 * 60 * 1_000
export const TIMER_CAPACITY = { maxGlobal: 32, maxPerCaller: 8 } as const

const NATIVE_OPERATION_TIMEOUT_MS = 5_000
const TERMINAL_TIMER_RETENTION = 500

export type TimerStartResult = Readonly<{
  accuracy: 'system_determined'
  firesAt: string
  scheduling: 'system_accepted'
  state: 'scheduled'
  timerId: string
}>

export type TimerStatusResult = Readonly<{
  firesAt: string
  observedAt: string
  presentation: 'system_determined' | 'unknown'
  scheduling: 'pending_observed' | 'not_pending' | 'unknown'
  state: 'scheduled' | 'schedule_missing' | 'deadline_elapsed' | 'cancelled' | 'status_unknown'
  timerId: string
}>

export type TimerCancelResult = Readonly<{
  presentation: 'unknown'
  state: 'cancelled'
  timerId: string
}>

export type TimerSnapshot = Readonly<{
  firesAt: string
  ownerSubjectId: string
  state: TimerState
  timerId: string
}>

export type TimerReconciliationReport = Readonly<{
  cancelled: number
  deadlineElapsed: number
  failures: number
  kept: number
  rearmed: number
}>

type NativeBoundary = Readonly<{
  expiresAt?: string
  signal?: AbortSignal
}>

type TimerIdentifierDeriver = (commandId: string) => Promise<Readonly<{
  notificationId: string
  timerId: string
}>>

function authorizationAvailability(
  authorization: NotificationAuthorization,
): CapabilityAvailability {
  switch (authorization.status) {
    case 'granted': return { status: 'available' }
    case 'requestable': return {
      reason: 'notification_permission_requestable',
      status: 'unavailable',
    }
    case 'denied': return { reason: 'notification_permission_denied', status: 'unavailable' }
    case 'channel_disabled': return {
      reason: 'notification_channel_disabled',
      status: 'unavailable',
    }
    case 'unavailable': return { reason: authorization.reason, status: 'unavailable' }
  }
}

export class LocalTimerController {
  readonly #listeners = new Set<() => void>()
  #revocationEpoch = 0

  constructor(
    private readonly repository: TimerRepository,
    private readonly notificationPort: LocalTimerNotificationPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly nativeOperationTimeoutMs = NATIVE_OPERATION_TIMEOUT_MS,
    private readonly identifierDeriver: TimerIdentifierDeriver = deriveLocalTimerIdentifiers,
  ) {}

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  validateStart(firesAt: string): void {
    const leadMs = Date.parse(firesAt) - this.clock().getTime()
    if (leadMs < TIMER_MINIMUM_LEAD_MS) {
      throw new ToolExecutionError(
        'timer_too_soon',
        '计时目标必须至少在当前时间 10 秒之后',
        false,
      )
    }
    if (leadMs > TIMER_MAXIMUM_LEAD_MS) {
      throw new ToolExecutionError(
        'timer_too_far',
        '当前 App 内计时器最多只能创建到 24 小时之后',
        false,
      )
    }
  }

  async probeStart(appState: string): Promise<CapabilityAvailability> {
    if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
    try {
      const authorization = await this.#bounded(
        this.notificationPort.getAuthorization(),
        {},
        'timer_probe_timeout',
      )
      return authorizationAvailability(authorization)
    } catch (error) {
      return {
        reason: error instanceof ToolExecutionError ? error.code : 'timer_probe_failed',
        status: 'unavailable',
      }
    }
  }

  probeControl(): Promise<CapabilityAvailability> {
    return Promise.resolve({ status: 'available' })
  }

  async start(
    argumentsValue: TimerStartArguments,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<TimerStartResult> {
    this.#assertMayCommit(signal, invocation.expiresAt)
    this.validateStart(argumentsValue.firesAt)
    const authorization = await this.#bounded(
      this.notificationPort.getAuthorization(),
      { expiresAt: invocation.expiresAt, signal },
      'timer_probe_timeout',
    )
    if (authorizationAvailability(authorization).status !== 'available') {
      throw new ToolExecutionError('timer_unavailable', '系统通知授权或 channel 不可用', false)
    }
    const identifiers = await this.identifierDeriver(invocation.commandId)
    if (
      !isTimerId(identifiers.timerId)
      || !isLocalTimerNotificationIdentifier(identifiers.notificationId)
    ) {
      throw new ToolExecutionError(
        'timer_identifier_invalid',
        '无法生成安全的本地计时器标识',
        false,
      )
    }
    this.#assertMayCommit(signal, invocation.expiresAt)
    this.validateStart(argumentsValue.firesAt)
    const epoch = this.#revocationEpoch
    const now = this.clock().toISOString()
    const reservation = await this.repository.reserve({
      firesAt: argumentsValue.firesAt,
      notificationId: identifiers.notificationId,
      now,
      ownerSubjectId: invocation.caller.subjectId,
      sourceCommandId: invocation.commandId,
      timerId: identifiers.timerId,
    }, TIMER_CAPACITY)
    if (reservation.kind === 'caller_capacity' || reservation.kind === 'global_capacity') {
      throw new ToolExecutionError(
        'timer_capacity_reached',
        reservation.kind === 'caller_capacity'
          ? '该调用方的活动计时器已达本地上限'
          : '设备活动计时器已达本地上限',
        false,
      )
    }
    if (reservation.kind === 'existing') {
      if (reservation.timer.state === 'scheduled') return this.#startResult(reservation.timer)
      throw new ToolExecutionError(
        'timer_schedule_status_unknown',
        '同一命令的计时器状态不明确，不会重复调度',
        false,
      )
    }

    const timer = reservation.timer
    try {
      this.#assertMayCommit(signal, invocation.expiresAt)
      this.validateStart(timer.firesAt)
      if (epoch !== this.#revocationEpoch) throw this.#cancelled()
    } catch (error) {
      await this.#compensateOrUnknown(timer)
      throw error
    }

    const rawSchedule = this.notificationPort.scheduleTimer({
      firesAt: timer.firesAt,
      notificationId: timer.notificationId,
    })
    let returnedIdentifier: string
    try {
      returnedIdentifier = await this.#bounded(
        rawSchedule,
        { expiresAt: invocation.expiresAt, signal },
        'timer_schedule_status_unknown',
      )
    } catch (error) {
      void rawSchedule.finally(() => this.#cleanupNative(timer.notificationId)).catch(() => undefined)
      const cleaned = await this.#cleanupNative(timer.notificationId)
      await this.repository.markState(
        timer.timerId,
        ['preparing'],
        cleaned ? 'cancelled' : 'status_unknown',
        this.clock().toISOString(),
      )
      this.#notify()
      if (!cleaned || error instanceof ToolExecutionError && error.code === 'timer_schedule_status_unknown') {
        throw new ToolExecutionError(
          'timer_schedule_status_unknown',
          '系统未能确认计时器调度状态；不会自动重试',
          false,
        )
      }
      if (error instanceof ToolExecutionError) throw error
      throw new ToolExecutionError(
        'timer_schedule_failed',
        '系统拒绝创建计时器，补偿清理已完成',
        true,
      )
    }

    if (
      returnedIdentifier !== timer.notificationId
      || !isLocalTimerNotificationIdentifier(returnedIdentifier)
      || epoch !== this.#revocationEpoch
    ) {
      await this.#compensateOrUnknown(timer)
      throw new ToolExecutionError(
        'timer_schedule_status_unknown',
        '系统返回的计时器标识或撤销状态不可信',
        false,
      )
    }
    const finalized = await this.repository.markState(
      timer.timerId,
      ['preparing'],
      'scheduled',
      this.clock().toISOString(),
    )
    if (!finalized) {
      await this.#compensateOrUnknown(timer)
      throw new ToolExecutionError(
        'timer_schedule_status_unknown',
        '计时器调度结果无法安全持久化',
        false,
      )
    }
    this.#notify()
    return this.#startResult({ ...timer, state: 'scheduled' })
  }

  async status(timerId: string, ownerSubjectId: string): Promise<TimerStatusResult> {
    const timer = await this.repository.getForOwner(timerId, ownerSubjectId)
    if (timer === null) throw new ToolExecutionError('not_found', '指定计时器不存在', false)
    const observedAt = this.clock().toISOString()
    if (timer.state === 'cancelled') {
      return {
        firesAt: timer.firesAt,
        observedAt,
        presentation: 'unknown',
        scheduling: 'not_pending',
        state: 'cancelled',
        timerId,
      }
    }
    if (timer.state === 'deadline_elapsed' || Date.parse(timer.firesAt) <= this.clock().getTime()) {
      return {
        firesAt: timer.firesAt,
        observedAt,
        presentation: 'unknown',
        scheduling: 'not_pending',
        state: 'deadline_elapsed',
        timerId,
      }
    }
    if (timer.state !== 'scheduled') return this.#unknownStatus(timer, observedAt)
    try {
      const pending = await this.#bounded(
        this.notificationPort.listScheduledIdentifiers(),
        {},
        'timer_status_timeout',
      )
      const isPending = pending.has(timer.notificationId)
      return {
        firesAt: timer.firesAt,
        observedAt,
        presentation: isPending ? 'system_determined' : 'unknown',
        scheduling: isPending ? 'pending_observed' : 'not_pending',
        state: isPending ? 'scheduled' : 'schedule_missing',
        timerId,
      }
    } catch {
      return this.#unknownStatus(timer, observedAt)
    }
  }

  async cancelForCaller(timerId: string, ownerSubjectId: string): Promise<TimerCancelResult> {
    const timer = await this.repository.getForOwner(timerId, ownerSubjectId)
    if (timer === null) throw new ToolExecutionError('not_found', '指定计时器不存在', false)
    return this.#cancelTimer(timer)
  }

  async cancelLocal(timerId: string): Promise<TimerCancelResult> {
    const timer = (await this.repository.listForReconciliation())
      .find(candidate => candidate.timerId === timerId)
    if (timer === undefined) {
      const active = (await this.repository.listActive()).find(candidate => candidate.timerId === timerId)
      if (active === undefined) throw new ToolExecutionError('not_found', '指定计时器不存在', false)
      return this.#cancelTimer(active)
    }
    return this.#cancelTimer(timer)
  }

  async stopAll(): Promise<number> {
    this.#revocationEpoch += 1
    const timers = await this.repository.listActive()
    let failures = 0
    for (const timer of timers) {
      try {
        await this.#cancelTimer(timer)
      } catch {
        failures += 1
      }
    }
    return failures
  }

  async getVisibleTimers(): Promise<readonly TimerSnapshot[]> {
    return (await this.repository.listActive()).map(timer => ({
      firesAt: timer.firesAt,
      ownerSubjectId: timer.ownerSubjectId,
      state: timer.state,
      timerId: timer.timerId,
    }))
  }

  async reconcile(disabled: boolean): Promise<TimerReconciliationReport> {
    const report = { cancelled: 0, deadlineElapsed: 0, failures: 0, kept: 0, rearmed: 0 }
    let pending: ReadonlySet<string>
    try {
      pending = await this.#bounded(
        this.notificationPort.listScheduledIdentifiers(),
        {},
        'timer_reconcile_timeout',
      )
    } catch {
      return { ...report, failures: 1 }
    }
    const timers = await this.repository.listForReconciliation()
    for (const timer of timers) {
      try {
        if (disabled || timer.sourceCommandStatus !== 'succeeded') {
          await this.#cancelAndFinalize(timer)
          report.cancelled += 1
          continue
        }
        if (Date.parse(timer.firesAt) <= this.clock().getTime()) {
          await this.#bounded(
            this.notificationPort.cancelScheduled(timer.notificationId),
            {},
            'timer_cancel_timeout',
          )
          await this.repository.markState(
            timer.timerId,
            ['preparing', 'scheduled', 'cancelling', 'status_unknown'],
            'deadline_elapsed',
            this.clock().toISOString(),
          )
          report.deadlineElapsed += 1
          continue
        }
        if (timer.state !== 'scheduled') {
          await this.#cancelAndFinalize(timer)
          report.cancelled += 1
          continue
        }
        if (pending.has(timer.notificationId)) {
          report.kept += 1
          continue
        }
        const authorization = await this.#bounded(
          this.notificationPort.getAuthorization(),
          {},
          'timer_probe_timeout',
        )
        if (authorizationAvailability(authorization).status !== 'available') {
          await this.repository.markState(
            timer.timerId,
            ['scheduled'],
            'status_unknown',
            this.clock().toISOString(),
          )
          report.failures += 1
          continue
        }
        const identifier = await this.#rearm(timer)
        if (identifier !== timer.notificationId) throw new Error('timer identifier mismatch')
        report.rearmed += 1
      } catch {
        await this.repository.markState(
          timer.timerId,
          ['preparing', 'scheduled', 'cancelling', 'status_unknown'],
          'status_unknown',
          this.clock().toISOString(),
        )
        report.failures += 1
      }
    }
    await this.repository.pruneTerminal(TERMINAL_TIMER_RETENTION)
    this.#notify()
    return report
  }

  async #cancelTimer(timer: StoredTimer): Promise<TimerCancelResult> {
    if (timer.state === 'cancelled') {
      return { presentation: 'unknown', state: 'cancelled', timerId: timer.timerId }
    }
    await this.repository.markState(
      timer.timerId,
      ['preparing', 'scheduled', 'deadline_elapsed', 'status_unknown'],
      'cancelling',
      this.clock().toISOString(),
    )
    const cleaned = await this.#cleanupNative(timer.notificationId)
    const state = cleaned ? 'cancelled' : 'status_unknown'
    await this.repository.markState(
      timer.timerId,
      ['preparing', 'scheduled', 'cancelling', 'deadline_elapsed', 'status_unknown'],
      state,
      this.clock().toISOString(),
    )
    this.#notify()
    if (!cleaned) {
      throw new ToolExecutionError(
        'timer_cancel_status_unknown',
        '系统未能确认计时器已清理；不会声称取消成功',
        false,
      )
    }
    return { presentation: 'unknown', state: 'cancelled', timerId: timer.timerId }
  }

  async #cancelAndFinalize(timer: StoredTimer): Promise<void> {
    const cleaned = await this.#cleanupNative(timer.notificationId)
    await this.repository.markState(
      timer.timerId,
      ['preparing', 'scheduled', 'cancelling', 'deadline_elapsed', 'status_unknown'],
      cleaned ? 'cancelled' : 'status_unknown',
      this.clock().toISOString(),
    )
    if (!cleaned) throw new Error('timer cleanup status unknown')
  }

  async #compensateOrUnknown(timer: StoredTimer): Promise<void> {
    const cleaned = await this.#cleanupNative(timer.notificationId)
    await this.repository.markState(
      timer.timerId,
      ['preparing', 'scheduled', 'cancelling'],
      cleaned ? 'cancelled' : 'status_unknown',
      this.clock().toISOString(),
    )
    this.#notify()
    if (!cleaned) {
      throw new ToolExecutionError(
        'timer_schedule_status_unknown',
        '计时器补偿清理状态不明确',
        false,
      )
    }
  }

  async #cleanupNative(notificationId: string): Promise<boolean> {
    const results = await Promise.allSettled([
      this.#bounded(
        this.notificationPort.cancelScheduled(notificationId),
        {},
        'timer_cancel_timeout',
      ),
      this.#bounded(
        this.notificationPort.dismissPresented(notificationId),
        {},
        'timer_dismiss_timeout',
      ),
    ])
    return results.every(result => result.status === 'fulfilled')
  }

  async #rearm(timer: StoredTimer): Promise<string> {
    const epoch = this.#revocationEpoch
    const rawSchedule = this.notificationPort.scheduleTimer({
      firesAt: timer.firesAt,
      notificationId: timer.notificationId,
    })
    let identifier: string
    try {
      identifier = await this.#bounded(rawSchedule, {}, 'timer_schedule_status_unknown')
    } catch (error) {
      void rawSchedule.finally(() => this.#cleanupNative(timer.notificationId)).catch(() => undefined)
      await this.#cleanupNative(timer.notificationId)
      throw error
    }
    if (epoch !== this.#revocationEpoch || identifier !== timer.notificationId) {
      await this.#cleanupNative(timer.notificationId)
      throw new Error('timer rearm crossed revocation boundary')
    }
    return identifier
  }

  async #bounded<T>(
    operation: Promise<T>,
    boundary: NativeBoundary,
    timeoutCode: string,
  ): Promise<T> {
    const { expiresAt, signal } = boundary
    if (signal?.aborted === true) throw this.#cancelled()
    const deadlineMs = expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(expiresAt)
    if (deadlineMs <= this.clock().getTime()) throw this.#expired()
    const waitMs = Math.min(this.nativeOperationTimeoutMs, deadlineMs - this.clock().getTime())
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => { finish(() => reject(this.#cancelled())) }
      const timeout = setTimeout(() => {
        const expired = expiresAt !== undefined && Date.parse(expiresAt) <= this.clock().getTime()
        finish(() => reject(expired ? this.#expired() : new ToolExecutionError(
          timeoutCode,
          '计时器原生操作超时',
          false,
        )))
      }, Math.max(0, waitMs))
      signal?.addEventListener('abort', onAbort, { once: true })
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

  #startResult(timer: StoredTimer): TimerStartResult {
    return {
      accuracy: 'system_determined',
      firesAt: timer.firesAt,
      scheduling: 'system_accepted',
      state: 'scheduled',
      timerId: timer.timerId,
    }
  }

  #unknownStatus(timer: StoredTimer, observedAt: string): TimerStatusResult {
    return {
      firesAt: timer.firesAt,
      observedAt,
      presentation: 'unknown',
      scheduling: 'unknown',
      state: 'status_unknown',
      timerId: timer.timerId,
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #cancelled(): ToolExecutionError {
    return new ToolExecutionError('cancelled', '计时器命令已取消', false)
  }

  #expired(): ToolExecutionError {
    return new ToolExecutionError('expired', '计时器命令已过期', false)
  }
}
