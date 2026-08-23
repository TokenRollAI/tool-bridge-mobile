import { CapabilityRegistry } from '@/capabilities/registry'
import { createInboxDeliveryCapability } from '@/inbox/capability'
import { InboxDeliveryController } from '@/inbox/controller'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import { MemoryInboxRepository } from '@/storage/inboxRepository'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type {
  InboxNotificationPort,
  LocalInboxNotificationRequest,
  NotificationAuthorization,
} from '@/capabilities/productivity/notificationAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async () => 'B'.repeat(64)),
  randomUUID: jest.fn(() => 'audit_inbox_01'),
}))

const clock = () => new Date('2026-08-23T10:00:01.000Z')
const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'online',
}

class FakeNotificationPort implements InboxNotificationPort {
  authorization: NotificationAuthorization = { status: 'granted' }
  readonly requests: LocalInboxNotificationRequest[] = []

  async getAuthorization(): Promise<NotificationAuthorization> {
    return this.authorization
  }

  async scheduleInbox(request: LocalInboxNotificationRequest): Promise<string> {
    this.requests.push(request)
    return request.notificationId
  }
}

function command(commandId: string): LocalCommand {
  return {
    arguments: {
      body: 'Sensitive subscription body',
      category: 'subscription',
      notify: false,
      sourceLabel: 'Daily Brief',
      sentAt: '2026-08-23T09:59:00.000Z',
      title: '今日订阅摘要',
      urgency: 'high',
    },
    caller: { displayName: 'Fixture Agent', subjectId: 'caller_inbox' },
    commandId,
    createdAt: '2026-08-23T10:00:00.000Z',
    expiresAt: '2026-08-23T10:01:00.000Z',
    path: 'phone/inbox',
    tool: 'deliver',
  }
}

function harness(
  capabilityContext: CapabilityContext = context,
  commandRepository = new MemoryCommandRepository(),
  inboxRepository = new MemoryInboxRepository(),
) {
  const notificationPort = new FakeNotificationPort()
  const registry = new CapabilityRegistry()
  registry.register(createInboxDeliveryCapability(new InboxDeliveryController(
    inboxRepository,
    notificationPort,
    clock,
  )))
  const confirmations = new LocalConfirmationCoordinator({ clock })
  const auditRepository = new MemoryAuditRepository()
  const executor = new LocalCommandExecutor({
    auditRepository,
    clock,
    commandRepository,
    confirmationCoordinator: confirmations,
    context: async () => capabilityContext,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return {
    auditRepository,
    commandRepository,
    confirmations,
    executor,
    inboxRepository,
    notificationPort,
  }
}

describe('phone/inbox.deliver local runtime contract', () => {
  test('Ask every time 先确认安全摘要，正文只进入专用信箱表', async () => {
    const fixture = harness()
    const pending = fixture.executor.execute(
      command('inbox_approved'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(fixture.inboxRepository.records.size).toBe(0)
    expect(fixture.confirmations.getPending()[0]).toMatchObject({
      details: [
        { label: '标题', value: '今日订阅摘要' },
        { label: '类型', value: 'subscription' },
        { label: '紧急程度', value: 'high' },
        { label: '本地通知', value: '不请求' },
      ],
      path: 'phone/inbox',
      tool: 'deliver',
    })
    expect(JSON.stringify(fixture.confirmations.getPending())).not.toContain('Sensitive')

    fixture.confirmations.approve('inbox_approved')
    await expect(pending).resolves.toMatchObject({
      ok: true,
      value: { notification: { status: 'not_requested' }, status: 'stored' },
    })
    expect(fixture.inboxRepository.records.size).toBe(1)
    expect(JSON.stringify(fixture.commandRepository.records.get('inbox_approved')))
      .not.toContain('Sensitive')
    expect(JSON.stringify(fixture.auditRepository.records)).not.toContain('Sensitive')
  })

  test('Disabled 与过期命令 zero insert', async () => {
    const disabled = harness({ ...context, controlMode: 'disabled', reachability: 'disabled' })
    await expect(disabled.executor.execute(
      command('inbox_disabled'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'disabled' }, ok: false })
    expect(disabled.inboxRepository.records.size).toBe(0)

    const expired = harness()
    await expect(expired.executor.execute({
      ...command('inbox_expired'),
      expiresAt: '2026-08-23T10:00:00.000Z',
    }, new AbortController().signal)).resolves.toMatchObject({
      error: { code: 'expired' },
      ok: false,
    })
    expect(expired.inboxRepository.records.size).toBe(0)
  })

  test('100 个并发重复、跨 executor replay 和清空后 replay 都不重建消息', async () => {
    const commandRepository = new MemoryCommandRepository()
    const inboxRepository = new MemoryInboxRepository()
    const first = harness(
      { ...context, controlMode: 'trusted_session' },
      commandRepository,
      inboxRepository,
    )
    await expect(Promise.all(Array.from({ length: 100 }, () => first.executor.execute(
      command('inbox_replayed'),
      new AbortController().signal,
    )))).resolves.toHaveLength(100)
    expect(inboxRepository.records.size).toBe(1)

    await expect(inboxRepository.clear()).resolves.toBe(1)
    const restarted = harness(
      { ...context, controlMode: 'trusted_session' },
      commandRepository,
      inboxRepository,
    )
    await expect(restarted.executor.execute(
      command('inbox_replayed'),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: true, value: { status: 'stored' } })
    expect(inboxRepository.records.size).toBe(0)
  })

  test('crash 遗留的 running command 只返回 result_unknown，不重放正文写入', async () => {
    const commandRepository = new MemoryCommandRepository()
    await commandRepository.claim(command('inbox_crashed'), '2026-08-23T10:00:00.000Z')
    await commandRepository.recoverInterrupted('2026-08-23T10:00:01.000Z')
    const restarted = harness(
      { ...context, controlMode: 'trusted_session' },
      commandRepository,
    )
    await expect(restarted.executor.execute(
      command('inbox_crashed'),
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'result_unknown' }, ok: false })
    expect(restarted.inboxRepository.records.size).toBe(0)
  })
})
