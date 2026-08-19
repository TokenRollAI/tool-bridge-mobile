import { createLocalNotificationCapability } from '@/capabilities/productivity/notificationCapability'
import { LocalNotificationController } from '@/capabilities/productivity/notificationController'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type {
  LocalNotificationAdapter,
  LocalNotificationRequest,
  NotificationAuthorization,
} from '@/capabilities/productivity/notificationAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const notificationId = `tb_local_notify_${'b'.repeat(64)}`
const clock = () => new Date('2026-08-19T00:00:01.000Z')

const activeContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

class FakeNotificationAdapter implements LocalNotificationAdapter {
  authorization: NotificationAuthorization = { status: 'granted' }
  readonly requests: LocalNotificationRequest[] = []

  async getAuthorization(): Promise<NotificationAuthorization> {
    return this.authorization
  }

  async initialize(): Promise<void> {}

  async requestAuthorization(): Promise<NotificationAuthorization> {
    return this.authorization
  }

  async schedule(request: LocalNotificationRequest): Promise<string> {
    this.requests.push(request)
    return notificationId
  }
}

function command(commandId: string, callerSubjectId = 'caller_a'): LocalCommand {
  return {
    arguments: {
      message: 'Sensitive notification body',
      purpose: '提醒用户查看任务',
    },
    caller: { displayName: 'Fixture Caller', subjectId: callerSubjectId },
    commandId,
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    path: 'phone/productivity',
    tool: 'notify',
  }
}

function createHarness(
  context: CapabilityContext = activeContext,
  commandRepository = new MemoryCommandRepository(),
) {
  const adapter = new FakeNotificationAdapter()
  const controller = new LocalNotificationController(adapter, clock)
  const registry = new CapabilityRegistry()
  registry.register(createLocalNotificationCapability(controller))
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
  return { adapter, auditRepository, commandRepository, confirmations, executor }
}

describe('phone/productivity.notify local runtime contract', () => {
  test('Ask every time 在通知 commit 前展示 purpose/message，结果不伪造 delivered', async () => {
    const harness = createHarness()
    const pending = harness.executor.execute(
      command('notify_approved'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(harness.adapter.requests).toEqual([])
    expect(harness.confirmations.getPending()[0]).toMatchObject({
      details: [{ label: '用途', value: '提醒用户查看任务' }, {
        label: '通知正文', value: 'Sensitive notification body',
      }],
      path: 'phone/productivity',
      tool: 'notify',
    })

    harness.confirmations.approve('notify_approved')
    await expect(pending).resolves.toEqual({
      ok: true,
      value: {
        notificationId,
        presentation: 'system_determined',
        scheduledAt: '2026-08-19T00:00:01.000Z',
        status: 'scheduled',
      },
    })
    expect(harness.adapter.requests).toEqual([{
      commandId: 'notify_approved',
      message: 'Sensitive notification body',
    }])
    expect(JSON.stringify(harness.commandRepository.records.get('notify_approved')))
      .not.toContain('Sensitive')
    expect(JSON.stringify(await harness.auditRepository.listRecent(10))).not.toContain('Sensitive')
    expect(JSON.stringify(await harness.auditRepository.listRecent(10))).not.toContain('提醒用户')
  })

  test('用户拒绝、Disabled、后台和未授权都 zero schedule', async () => {
    const rejected = createHarness()
    const pending = rejected.executor.execute(
      command('notify_rejected'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    rejected.confirmations.reject('notify_rejected')
    await expect(pending).resolves.toMatchObject({ error: { code: 'user_rejected' }, ok: false })
    expect(rejected.adapter.requests).toEqual([])

    for (const context of [
      { ...activeContext, controlMode: 'disabled' as const, reachability: 'disabled' as const },
      { ...activeContext, appState: 'background' as const },
    ]) {
      const harness = createHarness(context)
      await expect(harness.executor.execute(
        command(`notify_${context.controlMode}_${context.appState}`),
        new AbortController().signal,
      )).resolves.toMatchObject({ ok: false })
      expect(harness.adapter.requests).toEqual([])
      expect(harness.confirmations.getPending()).toEqual([])
    }

    const ungranted = createHarness()
    ungranted.adapter.authorization = { status: 'requestable' }
    await expect(ungranted.executor.execute(
      command('notify_ungranted'),
      new AbortController().signal,
    )).resolves.toMatchObject({
      error: { code: 'unavailable' },
      ok: false,
    })
    expect(ungranted.adapter.requests).toEqual([])
    expect(ungranted.confirmations.getPending()).toEqual([])
  })

  test('trusted session 在前台可执行，但确认前 caller admission 先限制通知洪泛', async () => {
    const trusted = createHarness({ ...activeContext, controlMode: 'trusted_session' })
    await expect(trusted.executor.execute(
      command('notify_trusted'),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: true, value: { status: 'scheduled' } })
    expect(trusted.confirmations.getPending()).toEqual([])
    expect(trusted.adapter.requests).toHaveLength(1)

    const limited = createHarness()
    const pending = Array.from({ length: 5 }, (_, index) => limited.executor.execute(
      command(`notify_rate_${index}`),
      new AbortController().signal,
    ))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(limited.confirmations.getPending()).toHaveLength(5)
    await expect(limited.executor.execute(
      command('notify_rate_6'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'rate_limited' }, ok: false })
    expect(limited.confirmations.getPending()).toHaveLength(5)
    expect(limited.adapter.requests).toEqual([])
    limited.confirmations.rejectAll('rejected')
    await Promise.all(pending)
  })

  test('100 个并发重复及新 executor 回放都只 schedule 一次', async () => {
    const commandRepository = new MemoryCommandRepository()
    const first = createHarness(activeContext, commandRepository)
    const outcomes = Array.from({ length: 100 }, () => first.executor.execute(
      command('notify_replayed'),
      new AbortController().signal,
    ))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    first.confirmations.approve('notify_replayed')
    await expect(Promise.all(outcomes)).resolves.toHaveLength(100)
    expect(first.adapter.requests).toHaveLength(1)

    const restarted = createHarness(activeContext, commandRepository)
    await expect(restarted.executor.execute(
      command('notify_replayed'),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: true, value: { status: 'scheduled' } })
    expect(restarted.adapter.requests).toEqual([])
    expect(restarted.confirmations.getPending()).toEqual([])
  })

  test('crash 遗留的 running notification command 只返回 result_unknown，绝不重放', async () => {
    const commandRepository = new MemoryCommandRepository()
    await commandRepository.claim(command('notify_crashed'), '2026-08-19T00:00:00.000Z')
    await commandRepository.recoverInterrupted('2026-08-19T00:00:01.000Z')
    const restarted = createHarness(activeContext, commandRepository)
    await expect(restarted.executor.execute(
      command('notify_crashed'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'result_unknown' }, ok: false })
    expect(restarted.adapter.requests).toEqual([])
  })
})
