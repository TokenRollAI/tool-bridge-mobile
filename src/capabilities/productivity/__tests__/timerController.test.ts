import { MemoryTimerRepository } from '@/storage/timerRepository'

import {
  LOCAL_TIMER_IDENTIFIER_PREFIX,
} from '../notificationAdapter'
import {
  LocalTimerController,
  TIMER_CAPACITY,
} from '../timerController'
import {
  timerReferenceArgumentsSchema,
  timerStartArgumentsSchema,
} from '../timerSchema'

import type {
  LocalTimerNotificationPort,
  LocalTimerNotificationRequest,
  NotificationAuthorization,
} from '../notificationAdapter'
import type { CapabilityInvocation } from '@/capabilities/types'

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, NONE: 2 },
  AndroidNotificationVisibility: { PRIVATE: 2 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}))

const now = '2026-08-19T00:00:00.000Z'
const firesAt = '2026-08-19T00:10:00.000Z'
const invocation: CapabilityInvocation = {
  caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
  commandId: 'timer_command_01',
  createdAt: now,
  expiresAt: '2026-08-19T00:01:00.000Z',
}

class FakeTimerPort implements LocalTimerNotificationPort {
  authorization: NotificationAuthorization = { status: 'granted' }
  readonly cancelled: string[] = []
  readonly dismissed: string[] = []
  readonly requests: LocalTimerNotificationRequest[] = []
  readonly scheduled = new Set<string>()
  scheduleImplementation: ((request: LocalTimerNotificationRequest) => Promise<string>) | null = null
  cancelError: Error | null = null

  async cancelScheduled(identifier: string): Promise<void> {
    this.cancelled.push(identifier)
    if (this.cancelError !== null) throw this.cancelError
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
    if (this.scheduleImplementation !== null) return this.scheduleImplementation(request)
    this.scheduled.add(request.notificationId)
    return request.notificationId
  }
}

function harness() {
  const repository = new MemoryTimerRepository()
  const port = new FakeTimerPort()
  const digest = 'a'.repeat(64)
  const controller = new LocalTimerController(
    repository,
    port,
    () => new Date(now),
    10,
    async () => ({
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${digest}`,
      timerId: `timer_${digest}`,
    }),
  )
  return { controller, port, repository }
}

describe('timer strict schemas', () => {
  test('start 只接受 canonical UTC firesAt 和安全 purpose', () => {
    expect(timerStartArgumentsSchema.parse({ firesAt, purpose: '  泡茶  ' }))
      .toEqual({ firesAt, purpose: '泡茶' })
    for (const invalid of [
      { firesAt: '2026-08-19T08:10:00+08:00', purpose: '泡茶' },
      { firesAt: '2026-08-19T00:10:00Z', purpose: '泡茶' },
      { firesAt, purpose: '   ' },
      { firesAt, purpose: '伪装\u202e系统' },
      { firesAt, purpose: '\n泡茶' },
      { firesAt, purpose: '泡茶\n' },
      { firesAt, purpose: '泡茶', repeat: true },
      { firesAt, message: '敏感正文', purpose: '泡茶' },
    ]) expect(timerStartArgumentsSchema.safeParse(invalid).success).toBe(false)
  })

  test('reference 只接受精确 timer id', () => {
    expect(timerReferenceArgumentsSchema.safeParse({ timerId: `timer_${'a'.repeat(64)}` }).success)
      .toBe(true)
    expect(timerReferenceArgumentsSchema.safeParse({ timerId: 'timer_unsafe' }).success).toBe(false)
    expect(timerReferenceArgumentsSchema.safeParse({
      timerId: `timer_${'a'.repeat(64)}`,
      owner: 'caller_b',
    }).success).toBe(false)
  })
})

describe('LocalTimerController', () => {
  afterEach(() => jest.useRealTimers())

  test('先 reserve 再用绝对目标调度，SQLite/native/result 都不含 purpose', async () => {
    const { controller, port, repository } = harness()
    const result = await controller.start(
      { firesAt, purpose: '敏感目的' },
      invocation,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      accuracy: 'system_determined',
      firesAt,
      scheduling: 'system_accepted',
      state: 'scheduled',
    })
    expect(result.timerId).toMatch(/^timer_[a-f0-9]{64}$/)
    expect(port.requests).toEqual([{
      firesAt,
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${result.timerId.slice('timer_'.length)}`,
    }])
    expect(JSON.stringify(repository.records)).not.toContain('敏感目的')
    expect(JSON.stringify(port.requests)).not.toContain('敏感目的')
    await expect(controller.status(result.timerId, 'caller_a')).resolves.toMatchObject({
      scheduling: 'pending_observed',
      state: 'scheduled',
    })
  })

  test('过近、过远、未授权和 commit 前取消均 zero schedule', async () => {
    const { controller, port } = harness()
    for (const target of [
      '2026-08-19T00:00:09.999Z',
      '2026-08-20T00:00:00.001Z',
    ]) {
      await expect(controller.start(
        { firesAt: target, purpose: '边界' },
        invocation,
        new AbortController().signal,
      )).rejects.toBeDefined()
    }
    port.authorization = { status: 'denied' }
    await expect(controller.start(
      { firesAt, purpose: '未授权' },
      invocation,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'timer_unavailable' })
    port.authorization = { status: 'granted' }
    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.start({ firesAt, purpose: '取消' }, invocation, aborted.signal))
      .rejects.toMatchObject({ code: 'cancelled' })
    expect(port.requests).toEqual([])
  })

  test('持久容量跨调用限制每 caller 8、全局 32', async () => {
    const { repository } = harness()
    for (let index = 0; index < TIMER_CAPACITY.maxPerCaller; index += 1) {
      await expect(repository.reserve({
        firesAt,
        notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${index.toString(16).padStart(64, '0')}`,
        now,
        ownerSubjectId: 'caller_a',
        sourceCommandId: `command_${index}`,
        timerId: `timer_${index.toString(16).padStart(64, '0')}`,
      }, TIMER_CAPACITY)).resolves.toMatchObject({ kind: 'reserved' })
    }
    await expect(repository.reserve({
      firesAt,
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'f'.repeat(64)}`,
      now,
      ownerSubjectId: 'caller_a',
      sourceCommandId: 'command_over',
      timerId: `timer_${'f'.repeat(64)}`,
    }, TIMER_CAPACITY)).resolves.toEqual({ kind: 'caller_capacity' })
  })

  test('native schedule 超时返回 unknown，并在迟到 resolve 后再次补偿取消', async () => {
    jest.useFakeTimers()
    const { controller, port, repository } = harness()
    let resolveSchedule: (identifier: string) => void = () => undefined
    port.scheduleImplementation = request => new Promise(resolve => {
      resolveSchedule = resolve
      port.scheduled.add(request.notificationId)
    })
    const pending = controller.start(
      { firesAt, purpose: '迟到任务' },
      invocation,
      new AbortController().signal,
    )
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'timer_schedule_status_unknown',
      retryable: false,
    })
    await jest.advanceTimersByTimeAsync(10)
    await rejection
    expect([...repository.records.values()][0]?.state).toBe('cancelled')
    const notificationId = port.requests[0]?.notificationId ?? ''
    resolveSchedule(notificationId)
    await Promise.resolve()
    await Promise.resolve()
    expect(port.cancelled.filter(value => value === notificationId).length).toBeGreaterThanOrEqual(2)
  })

  test('caller 隔离、状态查询和取消都不泄露异主计时器', async () => {
    const { controller, port } = harness()
    const started = await controller.start(
      { firesAt, purpose: '归属测试' },
      invocation,
      new AbortController().signal,
    )
    await expect(controller.status(started.timerId, 'caller_b'))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(controller.cancelForCaller(started.timerId, 'caller_b'))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(controller.cancelForCaller(started.timerId, 'caller_a')).resolves.toEqual({
      presentation: 'unknown',
      state: 'cancelled',
      timerId: started.timerId,
    })
    expect(port.cancelled).toContain(port.requests[0]?.notificationId)
    await expect(controller.cancelForCaller(started.timerId, 'caller_a'))
      .resolves.toMatchObject({ state: 'cancelled' })
  })

  test('native 已接受但 scheduled CAS 失败时立即补偿，不返回假成功', async () => {
    const { controller, port, repository } = harness()
    const originalMarkState = repository.markState.bind(repository)
    jest.spyOn(repository, 'markState').mockImplementation(
      (timerId, expected, state, updatedAt) => state === 'scheduled'
        ? Promise.resolve(false)
        : originalMarkState(timerId, expected, state, updatedAt),
    )
    await expect(controller.start(
      { firesAt, purpose: 'CAS 失败' },
      invocation,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'timer_schedule_status_unknown', retryable: false })
    expect(port.cancelled).toHaveLength(1)
    expect([...repository.records.values()][0]?.state).toBe('cancelled')
  })

  test('cancel native 状态不明时保留 status_unknown，不声称 cancelled', async () => {
    const { controller, port, repository } = harness()
    const started = await controller.start(
      { firesAt, purpose: '取消失败' },
      invocation,
      new AbortController().signal,
    )
    port.cancelError = new Error('fixture native cancel failure')
    await expect(controller.cancelForCaller(started.timerId, 'caller_a'))
      .rejects.toMatchObject({ code: 'timer_cancel_status_unknown', retryable: false })
    expect(repository.records.get(started.timerId)?.state).toBe('status_unknown')
  })

  test('reconcile 不重放 crash orphan；成功且 future/missing 才以同一 ID re-arm', async () => {
    const { controller, port, repository } = harness()
    const orphan = await repository.reserve({
      firesAt,
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'1'.repeat(64)}`,
      now,
      ownerSubjectId: 'caller_a',
      sourceCommandId: 'orphan_command',
      timerId: `timer_${'1'.repeat(64)}`,
    }, TIMER_CAPACITY)
    const successful = await repository.reserve({
      firesAt,
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'2'.repeat(64)}`,
      now,
      ownerSubjectId: 'caller_b',
      sourceCommandId: 'successful_command',
      timerId: `timer_${'2'.repeat(64)}`,
    }, TIMER_CAPACITY)
    expect(orphan.kind).toBe('reserved')
    expect(successful.kind).toBe('reserved')
    await repository.markState(`timer_${'2'.repeat(64)}`, ['preparing'], 'scheduled', now)
    repository.sourceCommandStatuses.set('orphan_command', 'unknown_after_crash')
    repository.sourceCommandStatuses.set('successful_command', 'succeeded')

    await expect(controller.reconcile(false)).resolves.toMatchObject({ cancelled: 1, rearmed: 1 })
    expect(repository.records.get(`timer_${'1'.repeat(64)}`)?.state).toBe('cancelled')
    expect(port.requests).toEqual([{
      firesAt,
      notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'2'.repeat(64)}`,
    }])
  })

  test('emergency stopAll 清理全部 future timer 并 bump 撤销边界', async () => {
    const { controller, repository } = harness()
    const started = await controller.start(
      { firesAt, purpose: '紧急停用' },
      invocation,
      new AbortController().signal,
    )
    await expect(controller.stopAll()).resolves.toBe(0)
    expect(repository.records.get(started.timerId)?.state).toBe('cancelled')
    await expect(controller.getVisibleTimers()).resolves.toEqual([])
  })

  test('emergency epoch 越过 pending schedule 时，迟到成功仍被补偿清理', async () => {
    const { controller, port, repository } = harness()
    let resolveSchedule: (identifier: string) => void = () => undefined
    let scheduleStarted: () => void = () => undefined
    const startedSignal = new Promise<void>(resolve => { scheduleStarted = resolve })
    port.scheduleImplementation = request => new Promise(resolve => {
      resolveSchedule = resolve
      port.scheduled.add(request.notificationId)
      scheduleStarted()
    })
    const pending = controller.start(
      { firesAt, purpose: '撤销竞态' },
      invocation,
      new AbortController().signal,
    )
    await startedSignal
    await expect(controller.stopAll()).resolves.toBe(0)
    const notificationId = port.requests[0]?.notificationId ?? ''
    resolveSchedule(notificationId)
    await expect(pending).rejects.toMatchObject({
      code: 'timer_schedule_status_unknown',
      retryable: false,
    })
    expect(port.cancelled.filter(value => value === notificationId).length).toBeGreaterThanOrEqual(2)
    expect([...repository.records.values()][0]?.state).toBe('cancelled')
  })
})
