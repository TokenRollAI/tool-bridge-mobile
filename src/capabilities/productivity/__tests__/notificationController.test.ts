import { LocalNotificationController } from '../notificationController'
import { localNotificationArgumentsSchema } from '../notificationSchema'

import type {
  LocalNotificationAdapter,
  LocalNotificationRequest,
  NotificationAuthorization,
} from '../notificationAdapter'
import type { CapabilityInvocation } from '@/capabilities/types'

const notificationId = `tb_local_notify_${'a'.repeat(64)}`
const argumentsValue = { message: '请检查后台任务', purpose: '提醒用户查看运行结果' }
const invocation: CapabilityInvocation = {
  caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
  commandId: 'notification_command_01',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T00:01:00.000Z',
}

class FakeNotificationAdapter implements LocalNotificationAdapter {
  authorization: NotificationAuthorization = { status: 'granted' }
  authorizationReads = 0
  initializeCalls = 0
  initializeError: Error | null = null
  requestCalls = 0
  requests: LocalNotificationRequest[] = []
  scheduleImplementation: ((request: LocalNotificationRequest) => Promise<string>) | null = null

  async getAuthorization(): Promise<NotificationAuthorization> {
    this.authorizationReads += 1
    return this.authorization
  }

  async initialize(): Promise<void> {
    this.initializeCalls += 1
    if (this.initializeError !== null) throw this.initializeError
  }

  async requestAuthorization(): Promise<NotificationAuthorization> {
    this.requestCalls += 1
    return this.authorization
  }

  async schedule(request: LocalNotificationRequest): Promise<string> {
    this.requests.push(request)
    return this.scheduleImplementation?.(request) ?? notificationId
  }
}

describe('local notification schema', () => {
  test('只接受 trim 后有内容的 purpose/message，拒绝控制、bidi 和高危字段', () => {
    expect(localNotificationArgumentsSchema.parse({
      message: '  消息  ',
      purpose: '  提醒  ',
    })).toEqual({ message: '消息', purpose: '提醒' })
    for (const invalid of [
      { message: '   ', purpose: '提醒' },
      { message: '消息\n伪装第二行', purpose: '提醒' },
      { message: '\n消息', purpose: '提醒' },
      { message: '消息', purpose: '提醒\n' },
      { message: '伪装\u202eexe.txt', purpose: '提醒' },
      { message: '消息', purpose: '   ' },
      { message: '消息', purpose: '提醒', title: '系统更新' },
      { data: { url: 'https://example.com' }, message: '消息', purpose: '提醒' },
      { message: '消息', purpose: '提醒', scheduleAt: 'tomorrow' },
    ]) expect(localNotificationArgumentsSchema.safeParse(invalid).success).toBe(false)
  })

  test('文本长度边界严格执行', () => {
    expect(localNotificationArgumentsSchema.safeParse({
      message: '界'.repeat(240),
      purpose: '用'.repeat(120),
    }).success).toBe(true)
    expect(localNotificationArgumentsSchema.safeParse({
      message: '界'.repeat(241),
      purpose: '用'.repeat(120),
    }).success).toBe(false)
  })
})

describe('LocalNotificationController', () => {
  afterEach(() => jest.useRealTimers())

  test('probe 反映前台、授权、channel 和初始化真实状态', async () => {
    const adapter = new FakeNotificationAdapter()
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:01.000Z'),
    )
    await controller.initialize()
    await expect(controller.probe('active')).resolves.toEqual({ status: 'available' })

    adapter.authorization = { status: 'requestable' }
    await expect(controller.probe('active')).resolves.toEqual({
      reason: 'notification_permission_requestable',
      status: 'unavailable',
    })
    adapter.authorization = { status: 'channel_disabled' }
    await expect(controller.probe('active')).resolves.toEqual({
      reason: 'notification_channel_disabled',
      status: 'unavailable',
    })

    const reads = adapter.authorizationReads
    await expect(controller.probe('background')).resolves.toEqual({
      reason: 'foreground_required',
      status: 'unavailable',
    })
    expect(adapter.authorizationReads).toBe(reads)

    const failedAdapter = new FakeNotificationAdapter()
    failedAdapter.initializeError = new Error('fixture')
    const failed = new LocalNotificationController(failedAdapter)
    await failed.initialize()
    await expect(failed.probe('active')).resolves.toEqual({
      reason: 'notification_initialization_failed',
      status: 'unavailable',
    })
  })

  test('本地权限请求先重建 channel，并对悬挂请求设置有界等待', async () => {
    const adapter = new FakeNotificationAdapter()
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:01.000Z'),
    )
    await expect(controller.requestPermission()).resolves.toEqual({ status: 'granted' })
    expect(adapter.initializeCalls).toBe(1)
    expect(adapter.requestCalls).toBe(1)

    jest.useFakeTimers()
    adapter.requestAuthorization = () => new Promise(() => undefined)
    const pending = controller.requestPermission()
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'notification_permission_request_timeout',
    })
    await jest.advanceTimersByTimeAsync(60_000)
    await rejection
  })

  test('权限不可用、commit 前取消或过期都不调用 native schedule', async () => {
    const adapter = new FakeNotificationAdapter()
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:01.000Z'),
    )
    adapter.authorization = { status: 'denied' }
    await expect(controller.notify(
      argumentsValue,
      invocation,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'notification_unavailable' })

    adapter.authorization = { status: 'granted' }
    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.notify(argumentsValue, invocation, aborted.signal))
      .rejects.toMatchObject({ code: 'cancelled' })
    await expect(controller.notify(
      argumentsValue,
      { ...invocation, expiresAt: '2026-08-19T00:00:00.000Z' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'expired' })
    expect(adapter.requests).toEqual([])
  })

  test('等待权限 probe 时的取消不会跨过 commit 点', async () => {
    let resolveAuthorization: (value: NotificationAuthorization) => void = () => undefined
    const adapter = new FakeNotificationAdapter()
    adapter.getAuthorization = () => new Promise(resolve => { resolveAuthorization = resolve })
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:01.000Z'),
    )
    const abortController = new AbortController()
    const pending = controller.notify(argumentsValue, invocation, abortController.signal)
    abortController.abort()
    resolveAuthorization({ status: 'granted' })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(adapter.requests).toEqual([])
  })

  test('native commit 后不再用取消伪造零副作用，结果只报 scheduled', async () => {
    let resolveSchedule: (value: string) => void = () => undefined
    let reportSchedule: (() => void) | null = null
    const scheduleStarted = new Promise<void>(resolve => { reportSchedule = resolve })
    const adapter = new FakeNotificationAdapter()
    adapter.scheduleImplementation = () => new Promise(resolve => {
      resolveSchedule = resolve
      reportSchedule?.()
    })
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:02.000Z'),
    )
    const abortController = new AbortController()
    const pending = controller.notify(argumentsValue, invocation, abortController.signal)
    await scheduleStarted
    abortController.abort()
    resolveSchedule(notificationId)
    await expect(pending).resolves.toEqual({
      notificationId,
      presentation: 'system_determined',
      scheduledAt: '2026-08-19T00:00:02.000Z',
      status: 'scheduled',
    })
    expect(adapter.requests).toEqual([{
      commandId: 'notification_command_01',
      message: '请检查后台任务',
    }])
    expect(JSON.stringify(adapter.requests)).not.toContain('Fixture Caller')
    expect(JSON.stringify(adapter.requests)).not.toContain('提醒用户')
  })

  test('native 拒绝、悬挂或无效 ID 都是不可重试的结果未知', async () => {
    const adapter = new FakeNotificationAdapter()
    const controller = new LocalNotificationController(
      adapter,
      () => new Date('2026-08-19T00:00:01.000Z'),
      10,
    )
    adapter.scheduleImplementation = async () => { throw new Error('fixture') }
    await expect(controller.notify(argumentsValue, invocation, new AbortController().signal))
      .rejects.toMatchObject({ code: 'notification_status_unknown', retryable: false })

    adapter.scheduleImplementation = async () => 'unsafe-id'
    await expect(controller.notify(argumentsValue, invocation, new AbortController().signal))
      .rejects.toMatchObject({ code: 'notification_status_unknown', retryable: false })

    jest.useFakeTimers()
    adapter.scheduleImplementation = () => new Promise(() => undefined)
    const pending = controller.notify(argumentsValue, invocation, new AbortController().signal)
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'notification_status_unknown',
      retryable: false,
    })
    await jest.advanceTimersByTimeAsync(10)
    await rejection
  })
})
