import { ToolExecutionError, type CapabilityInvocation } from '@/capabilities/types'

import { deriveLocalInboxIdentifiers } from './identifiers'

import type { InboxNotificationPort } from '@/capabilities/productivity/notificationAdapter'
import type {
  InboxDeliveryArguments,
  InboxDeliveryResult,
  InboxNotificationResult,
} from '@/inbox/schema'
import type { InboxRepository } from '@/inbox/types'

const NATIVE_OPERATION_TIMEOUT_MS = 5_000
const SAFE_INBOX_NOTIFICATION_IDENTIFIER = /^tb_local_inbox_[a-f0-9]{64}$/

export class InboxDeliveryController {
  constructor(
    private readonly repository: InboxRepository,
    private readonly notificationPort: InboxNotificationPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly onStored: () => void = () => undefined,
    private readonly nativeOperationTimeoutMs = NATIVE_OPERATION_TIMEOUT_MS,
  ) {}

  async deliver(
    argumentsValue: InboxDeliveryArguments,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<InboxDeliveryResult> {
    this.#assertMayStore(signal, invocation.expiresAt)
    const identifiers = await deriveLocalInboxIdentifiers(invocation.commandId)
    this.#assertMayStore(signal, invocation.expiresAt)
    const receivedAt = this.clock().toISOString()
    const stored = await this.repository.add({
      body: argumentsValue.body,
      callerDisplayName: invocation.caller.displayName ?? null,
      callerSubjectId: invocation.caller.subjectId,
      category: argumentsValue.category,
      format: argumentsValue.format,
      messageId: identifiers.messageId,
      receivedAt,
      sentAt: argumentsValue.sentAt ?? null,
      sourceCommandId: invocation.commandId,
      sourceLabel: argumentsValue.sourceLabel ?? null,
      title: argumentsValue.title,
      urgency: argumentsValue.urgency,
    })
    try { this.onStored() } catch { /* UI invalidation must not change the committed result. */ }

    const notification = argumentsValue.notify
      ? await this.#bestEffortNotification(
        identifiers.notificationId,
        invocation.expiresAt,
        signal,
      )
      : { status: 'not_requested' as const }

    return {
      messageId: stored.messageId,
      notification,
      receivedAt: stored.receivedAt,
      status: 'stored',
    }
  }

  async #bestEffortNotification(
    notificationId: string,
    expiresAt: string,
    signal: AbortSignal,
  ): Promise<InboxNotificationResult> {
    if (signal.aborted || Date.parse(expiresAt) <= this.clock().getTime()) {
      return { status: 'not_attempted' }
    }
    try {
      const authorization = await this.#bounded(this.notificationPort.getAuthorization())
      if (authorization.status === 'requestable') return { status: 'permission_required' }
      if (authorization.status !== 'granted') return { status: 'unavailable' }
      if (signal.aborted || Date.parse(expiresAt) <= this.clock().getTime()) {
        return { status: 'not_attempted' }
      }
      const scheduledId = await this.#bounded(
        this.notificationPort.scheduleInbox({ notificationId }),
      )
      if (
        scheduledId !== notificationId
        || !SAFE_INBOX_NOTIFICATION_IDENTIFIER.test(scheduledId)
      ) return { status: 'status_unknown' }
      return { notificationId: scheduledId, status: 'scheduled' }
    } catch {
      return { status: 'status_unknown' }
    }
  }

  async #bounded<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        finish(() => reject(new Error('本地通知操作超时')))
      }, this.nativeOperationTimeoutMs)
      operation.then(
        value => { finish(() => resolve(value)) },
        error => { finish(() => reject(error)) },
      )
    })
  }

  #assertMayStore(signal: AbortSignal, expiresAt: string): void {
    if (signal.aborted) throw new ToolExecutionError('cancelled', '命令已取消', false)
    if (Date.parse(expiresAt) <= this.clock().getTime()) {
      throw new ToolExecutionError('expired', '命令已过期', false)
    }
  }
}
