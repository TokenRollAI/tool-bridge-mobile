import {
  createTimerCancelCapability,
  createTimerStartCapability,
  createTimerStatusCapability,
} from '@/capabilities/productivity/timerCapabilities'
import { LocalTimerController } from '@/capabilities/productivity/timerController'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'
import { MemoryTimerRepository } from '@/storage/timerRepository'

import type {
  LocalTimerNotificationPort,
  LocalTimerNotificationRequest,
  NotificationAuthorization,
} from '@/capabilities/productivity/notificationAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, NONE: 2 },
  AndroidNotificationVisibility: { PRIVATE: 2 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}))

const clock = () => new Date('2026-08-19T00:00:00.000Z')
const firesAt = '2026-08-19T00:10:00.000Z'
const activeContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

class FakeTimerPort implements LocalTimerNotificationPort {
  authorization: NotificationAuthorization = { status: 'granted' }
  readonly cancelled: string[] = []
  readonly dismissed: string[] = []
  readonly requests: LocalTimerNotificationRequest[] = []
  readonly scheduled = new Set<string>()

  async cancelScheduled(identifier: string): Promise<void> {
    this.cancelled.push(identifier)
    this.scheduled.delete(identifier)
  }

  async dismissPresented(identifier: string): Promise<void> {
    this.dismissed.push(identifier)
  }

  async getAuthorization(): Promise<NotificationAuthorization> {
    return this.authorization
  }

  async listScheduledIdentifiers(): Promise<ReadonlySet<string>> {
    return new Set(this.scheduled)
  }

  async scheduleTimer(request: LocalTimerNotificationRequest): Promise<string> {
    this.requests.push(request)
    this.scheduled.add(request.notificationId)
    return request.notificationId
  }
}

function startCommand(
  commandId: string,
  callerSubjectId = 'caller_a',
  purpose = '敏感计时用途',
): LocalCommand {
  return {
    arguments: { firesAt, purpose },
    caller: { displayName: 'Fixture Caller', subjectId: callerSubjectId },
    commandId,
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T00:01:00.000Z',
    path: 'phone/productivity',
    tool: 'timer_start',
  }
}

function referenceCommand(
  commandId: string,
  tool: 'timer_cancel' | 'timer_status',
  timerId: string,
  callerSubjectId = 'caller_a',
): LocalCommand {
  return {
    arguments: { timerId },
    caller: { displayName: 'Fixture Caller', subjectId: callerSubjectId },
    commandId,
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T00:01:00.000Z',
    path: 'phone/productivity',
    tool,
  }
}

function createHarness(
  context: CapabilityContext = activeContext,
  commandRepository = new MemoryCommandRepository(),
  timerRepository = new MemoryTimerRepository(),
) {
  const port = new FakeTimerPort()
  const digests = new Map<string, string>()
  const controller = new LocalTimerController(
    timerRepository,
    port,
    clock,
    5_000,
    async commandId => {
      let digest = digests.get(commandId)
      if (digest === undefined) {
        digest = (digests.size + 1).toString(16).padStart(64, '0')
        digests.set(commandId, digest)
      }
      return {
        notificationId: `tb_local_timer_${digest}`,
        timerId: `timer_${digest}`,
      }
    },
  )
  const registry = new CapabilityRegistry()
  registry.register(createTimerStartCapability(controller))
  registry.register(createTimerCancelCapability(controller))
  registry.register(createTimerStatusCapability(controller))
  const confirmations = new LocalConfirmationCoordinator({ clock })
  const auditRepository = new MemoryAuditRepository()
  const executor = new LocalCommandExecutor({
    auditRepository,
    clock,
    commandRepository,
    confirmationCoordinator: confirmations,
    context: async () => context,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return {
    auditRepository,
    commandRepository,
    confirmations,
    controller,
    executor,
    port,
    timerRepository,
  }
}

describe('phone/productivity timer local runtime contract', () => {
  test('Ask every time 在 commit 前展示 purpose/firesAt，成功结果不声称 fired', async () => {
    const harness = createHarness()
    const pending = harness.executor.execute(
      startCommand('timer_approved'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(harness.port.requests).toEqual([])
    expect(harness.confirmations.getPending()[0]).toMatchObject({
      details: [{ label: '用途', value: '敏感计时用途' }, { label: '目标时间', value: firesAt }],
      path: 'phone/productivity',
      tool: 'timer_start',
    })
    harness.confirmations.approve('timer_approved')
    const outcome = await pending
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        accuracy: 'system_determined',
        firesAt,
        scheduling: 'system_accepted',
        state: 'scheduled',
      },
    })
    expect(JSON.stringify(outcome)).not.toMatch(/fired|delivered|presented|clicked|on_time/)
    expect(harness.port.requests).toHaveLength(1)
    expect(JSON.stringify(harness.timerRepository.records)).not.toContain('敏感计时用途')
    expect(JSON.stringify(harness.commandRepository.records)).not.toContain('敏感计时用途')
    expect(JSON.stringify(harness.auditRepository.records)).not.toContain('敏感计时用途')
  })

  test('用户拒绝、Disabled、后台、确认中取消/过期均 zero native schedule', async () => {
    const rejected = createHarness()
    const rejectedPending = rejected.executor.execute(
      startCommand('timer_rejected'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    rejected.confirmations.reject('timer_rejected')
    await expect(rejectedPending).resolves.toMatchObject({
      error: { code: 'user_rejected' },
      ok: false,
    })
    expect(rejected.port.requests).toEqual([])

    for (const context of [{
      ...activeContext,
      controlMode: 'disabled' as const,
      reachability: 'disabled' as const,
    }, {
      ...activeContext,
      appState: 'background' as const,
    }]) {
      const harness = createHarness(context)
      await expect(harness.executor.execute(
        startCommand(`timer_${context.controlMode}_${context.appState}`),
        new AbortController().signal,
      )).resolves.toMatchObject({ ok: false })
      expect(harness.port.requests).toEqual([])
      expect(harness.confirmations.getPending()).toEqual([])
    }

    const cancelled = createHarness()
    const abortController = new AbortController()
    const cancelledPending = cancelled.executor.execute(
      startCommand('timer_cancelled_while_confirming'),
      abortController.signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    abortController.abort()
    await expect(cancelledPending).resolves.toMatchObject({ error: { code: 'cancelled' }, ok: false })
    expect(cancelled.port.requests).toEqual([])
  })

  test('100 个并发重复和新 executor replay 只有一个 DB row/native schedule', async () => {
    const commandRepository = new MemoryCommandRepository()
    const timerRepository = new MemoryTimerRepository()
    const first = createHarness(activeContext, commandRepository, timerRepository)
    const outcomes = Array.from({ length: 100 }, () => first.executor.execute(
      startCommand('timer_replayed'),
      new AbortController().signal,
    ))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    first.confirmations.approve('timer_replayed')
    await expect(Promise.all(outcomes)).resolves.toHaveLength(100)
    expect(first.port.requests).toHaveLength(1)
    expect(timerRepository.records.size).toBe(1)

    const restarted = createHarness(activeContext, commandRepository, timerRepository)
    await expect(restarted.executor.execute(
      startCommand('timer_replayed'),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: true, value: { state: 'scheduled' } })
    expect(restarted.port.requests).toEqual([])
    expect(restarted.confirmations.getPending()).toEqual([])
  })

  test('timer_status/cancel 仅作用于同 caller；取消仍不声称从未呈现', async () => {
    const harness = createHarness({ ...activeContext, controlMode: 'trusted_session' })
    const started = await harness.executor.execute(
      startCommand('timer_owned'),
      new AbortController().signal,
    )
    if (!started.ok) throw new Error('fixture timer start failed')
    const timerId = (started.value as { timerId: string }).timerId

    await expect(harness.executor.execute(
      referenceCommand('timer_foreign_status', 'timer_status', timerId, 'caller_b'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'not_found' }, ok: false })
    await expect(harness.executor.execute(
      referenceCommand('timer_foreign_cancel', 'timer_cancel', timerId, 'caller_b'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'not_found' }, ok: false })

    await expect(harness.executor.execute(
      referenceCommand('timer_owner_status', 'timer_status', timerId),
      new AbortController().signal,
    )).resolves.toMatchObject({
      ok: true,
      value: { scheduling: 'pending_observed', state: 'scheduled' },
    })
    await expect(harness.executor.execute(
      referenceCommand('timer_owner_cancel', 'timer_cancel', timerId),
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: { presentation: 'unknown', state: 'cancelled', timerId },
    })
    expect(harness.port.cancelled).toHaveLength(1)
    expect(harness.port.dismissed).toHaveLength(1)
  })

  test('crash 后 source command unknown 的 timer 只清理，绝不重调度', async () => {
    const harness = createHarness({ ...activeContext, controlMode: 'trusted_session' })
    const command = startCommand('timer_crashed')
    await harness.commandRepository.claim(command, clock().toISOString())
    const reservation = await harness.timerRepository.reserve({
      firesAt,
      notificationId: `tb_local_timer_${'c'.repeat(64)}`,
      now: clock().toISOString(),
      ownerSubjectId: command.caller.subjectId,
      sourceCommandId: command.commandId,
      timerId: `timer_${'c'.repeat(64)}`,
    }, { maxGlobal: 32, maxPerCaller: 8 })
    expect(reservation.kind).toBe('reserved')
    harness.port.scheduled.add(`tb_local_timer_${'c'.repeat(64)}`)
    await harness.commandRepository.recoverInterrupted(clock().toISOString())
    harness.timerRepository.sourceCommandStatuses.set(command.commandId, 'unknown_after_crash')

    await expect(harness.controller.reconcile(false)).resolves.toMatchObject({
      cancelled: 1,
      rearmed: 0,
    })
    expect(harness.port.requests).toEqual([])
    expect(harness.port.cancelled).toContain(`tb_local_timer_${'c'.repeat(64)}`)
  })
})
