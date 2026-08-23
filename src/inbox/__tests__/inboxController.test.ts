import { z } from 'zod'

import { MemoryInboxRepository } from '@/storage/inboxRepository'

import { InboxDeliveryController } from '../controller'
import {
  INBOX_BODY_MAX_CHARACTERS,
  inboxDeliveryArgumentsSchema,
} from '../schema'

import type {
  InboxNotificationPort,
  LocalInboxNotificationRequest,
  NotificationAuthorization,
} from '@/capabilities/productivity/notificationAdapter'
import type { CapabilityInvocation } from '@/capabilities/types'

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async () => 'A'.repeat(64)),
}))

const clock = () => new Date('2026-08-23T10:00:01.000Z')
const invocation: CapabilityInvocation = {
  caller: { displayName: 'Daily Agent', subjectId: 'caller_daily' },
  commandId: 'inbox_command_01',
  createdAt: '2026-08-23T10:00:00.000Z',
  expiresAt: '2026-08-23T10:01:00.000Z',
}

class FakeInboxNotificationPort implements InboxNotificationPort {
  authorization: NotificationAuthorization = { status: 'granted' }
  error: Error | null = null
  readonly requests: LocalInboxNotificationRequest[] = []

  async getAuthorization(): Promise<NotificationAuthorization> {
    return this.authorization
  }

  async scheduleInbox(request: LocalInboxNotificationRequest): Promise<string> {
    this.requests.push(request)
    if (this.error !== null) throw this.error
    return request.notificationId
  }
}

const argumentsValue = inboxDeliveryArgumentsSchema.parse({
  body: '第一条\n第二条',
  category: 'subscription' as const,
  notify: true,
  sentAt: '2026-08-23T09:59:00.000Z',
  sourceLabel: 'Daily Brief',
  title: '今日订阅摘要',
  urgency: 'high',
})

describe('device inbox controller', () => {
  test('strict schema 规范换行/default，并拒绝 URL action、control 与 bidi', () => {
    expect(inboxDeliveryArgumentsSchema.parse({ body: ' a\r\nb ', title: ' 标题 ' })).toEqual({
      body: 'a\nb',
      category: 'message',
      format: 'markdown',
      notify: false,
      title: '标题',
      urgency: 'normal',
    })
    expect(inboxDeliveryArgumentsSchema.safeParse({
      body: '正文',
      sentAt: '2026-08-23T10:00:00Z',
      title: '标题',
    }).success).toBe(false)
    expect(inboxDeliveryArgumentsSchema.safeParse({
      body: '正文',
      title: '标题',
      url: 'https://example.com',
    }).success).toBe(false)
    expect(inboxDeliveryArgumentsSchema.safeParse({ body: '正文\u0000', title: '标题' }).success)
      .toBe(false)
    expect(inboxDeliveryArgumentsSchema.safeParse({ body: '正文', title: '新闻\u202e设置' }).success)
      .toBe(false)
  })

  test('正文接受 64,000 字符、拒绝 64,001 字符，并向 Agent 暴露相同上限', () => {
    const maximumBody = '闻'.repeat(INBOX_BODY_MAX_CHARACTERS)
    expect(inboxDeliveryArgumentsSchema.safeParse({
      body: maximumBody,
      title: '长篇新闻整理',
    }).success).toBe(true)
    expect(inboxDeliveryArgumentsSchema.safeParse({
      body: `${maximumBody}闻`,
      title: '超限新闻整理',
    }).success).toBe(false)
    expect(z.toJSONSchema(inboxDeliveryArgumentsSchema)).toMatchObject({
      properties: {
        body: { maxLength: INBOX_BODY_MAX_CHARACTERS },
      },
    })
  })

  test('先存储正文，再用固定 identifier best-effort 请求本地通知', async () => {
    const repository = new MemoryInboxRepository()
    const notificationPort = new FakeInboxNotificationPort()
    const onStored = jest.fn()
    const controller = new InboxDeliveryController(repository, notificationPort, clock, onStored)

    await expect(controller.deliver(
      argumentsValue,
      invocation,
      new AbortController().signal,
    )).resolves.toEqual({
      messageId: `inbox_${'a'.repeat(64)}`,
      notification: {
        notificationId: `tb_local_inbox_${'a'.repeat(64)}`,
        status: 'scheduled',
      },
      receivedAt: '2026-08-23T10:00:01.000Z',
      status: 'stored',
    })
    expect(onStored).toHaveBeenCalledTimes(1)
    expect(await repository.list({ searchQuery: '', sort: 'received_desc' }, 10)).toEqual([expect.objectContaining({
      body: '第一条\n第二条',
      callerDisplayName: 'Daily Agent',
      callerSubjectId: 'caller_daily',
      sourceLabel: 'Daily Brief',
      sentAt: '2026-08-23T09:59:00.000Z',
      title: '今日订阅摘要',
      urgency: 'high',
    })])
    expect(notificationPort.requests).toEqual([{
      notificationId: `tb_local_inbox_${'a'.repeat(64)}`,
    }])
    expect(JSON.stringify(notificationPort.requests)).not.toContain('今日订阅摘要')
    expect(JSON.stringify(notificationPort.requests)).not.toContain('第一条')
  })

  test('未授权或 native 失败不回滚已提交消息，也不伪造 presented', async () => {
    const ungrantedRepository = new MemoryInboxRepository()
    const ungrantedPort = new FakeInboxNotificationPort()
    ungrantedPort.authorization = { status: 'requestable' }
    const ungranted = new InboxDeliveryController(ungrantedRepository, ungrantedPort, clock)
    await expect(ungranted.deliver(
      argumentsValue,
      invocation,
      new AbortController().signal,
    )).resolves.toMatchObject({
      notification: { status: 'permission_required' },
      status: 'stored',
    })
    expect(ungrantedRepository.records.size).toBe(1)
    expect(ungrantedPort.requests).toEqual([])

    const failedRepository = new MemoryInboxRepository()
    const failedPort = new FakeInboxNotificationPort()
    failedPort.error = new Error('native failed')
    const failed = new InboxDeliveryController(failedRepository, failedPort, clock)
    await expect(failed.deliver(
      argumentsValue,
      invocation,
      new AbortController().signal,
    )).resolves.toMatchObject({
      notification: { status: 'status_unknown' },
      status: 'stored',
    })
    expect(failedRepository.records.size).toBe(1)
  })

  test('取消或到期在 SQLite commit 前拒绝且 zero insert', async () => {
    const repository = new MemoryInboxRepository()
    const controller = new InboxDeliveryController(
      repository,
      new FakeInboxNotificationPort(),
      clock,
    )
    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.deliver(argumentsValue, invocation, aborted.signal))
      .rejects.toMatchObject({ code: 'cancelled' })
    await expect(controller.deliver(argumentsValue, {
      ...invocation,
      expiresAt: '2026-08-23T10:00:00.000Z',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'expired' })
    expect(repository.records.size).toBe(0)
  })
})
