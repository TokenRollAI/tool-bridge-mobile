import { LocalConfirmationCoordinator } from '../localConfirmationCoordinator'

import type { CapabilityDescriptor } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const descriptor: CapabilityDescriptor = {
  confirmation: 'always',
  description: '需要本地确认的 fixture',
  effect: 'write',
  limits: {
    maxResultBytes: 1_024,
    rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
  },
  path: 'phone/fixture',
  queuePolicy: 'reject_offline',
  risk: 'high',
  tool: 'run',
}

const command: LocalCommand = {
  arguments: { secret: 'must-not-project' },
  caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
  commandId: 'command_a',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T00:01:00.000Z',
  path: 'phone/fixture',
  tool: 'run',
}

describe('LocalConfirmationCoordinator', () => {
  afterEach(() => jest.useRealTimers())

  test('只投影调用元数据，批准后清理 pending', async () => {
    const coordinator = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
    })
    const resolution = coordinator.request(command, descriptor, [], new AbortController().signal)

    expect(coordinator.getPending()).toEqual([expect.objectContaining({
      callerDisplayName: 'Fixture Caller',
      commandId: 'command_a',
      risk: 'high',
    })])
    expect(JSON.stringify(coordinator.getPending())).not.toContain('must-not-project')
    expect(coordinator.approve('command_a')).toBe(true)
    await expect(resolution).resolves.toBe('approved')
    expect(coordinator.getPending()).toEqual([])
  })

  test('过期、AbortSignal 和 emergency disable 都会结束等待', async () => {
    jest.useFakeTimers()
    const coordinator = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:59.000Z'),
    })
    const expired = coordinator.request(command, descriptor, [], new AbortController().signal)
    await jest.advanceTimersByTimeAsync(1_000)
    await expect(expired).resolves.toBe('expired')

    const abortController = new AbortController()
    const cancelled = coordinator.request(
      { ...command, commandId: 'command_b', expiresAt: '2026-08-19T00:02:00.000Z' },
      descriptor,
      [],
      abortController.signal,
    )
    abortController.abort()
    await expect(cancelled).resolves.toBe('cancelled')

    const disabled = coordinator.request(
      { ...command, commandId: 'command_c', expiresAt: '2026-08-19T00:02:00.000Z' },
      descriptor,
      [],
      new AbortController().signal,
    )
    coordinator.rejectAll('disabled')
    await expect(disabled).resolves.toBe('disabled')
  })

  test('队列有硬上限且重复 commandId 复用同一等待', async () => {
    const coordinator = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
      maximumPending: 1,
    })
    const first = coordinator.request(command, descriptor, [], new AbortController().signal)
    expect(coordinator.request(command, descriptor, [], new AbortController().signal)).toBe(first)
    await expect(coordinator.request(
      { ...command, commandId: 'command_b' },
      descriptor,
      [],
      new AbortController().signal,
    )).resolves.toBe('queue_full')
    coordinator.reject('command_a')
    await expect(first).resolves.toBe('rejected')
  })
})
