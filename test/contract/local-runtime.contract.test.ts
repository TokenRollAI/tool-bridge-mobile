import { CapabilityRegistry } from '@/capabilities/registry'
import { createStatusCapability } from '@/capabilities/status/statusCapability'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type { StatusProbe } from '@/capabilities/status/probe'
import type { CapabilityContext } from '@/capabilities/types'
import type { CommandClaim } from '@/commands/repository'
import type { LocalCommand } from '@/commands/types'

const command: LocalCommand = {
  arguments: {},
  caller: { subjectId: 'caller_key_01' },
  commandId: 'command_01',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T01:00:00.000Z',
  path: 'phone/status',
  tool: 'get',
}

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

class DelayedClaimRepository extends MemoryCommandRepository {
  readonly claimStarted: Promise<void>
  #releaseClaim: (() => void) | null = null
  #reportClaimStarted: (() => void) | null = null

  constructor() {
    super()
    this.claimStarted = new Promise(resolve => { this.#reportClaimStarted = resolve })
  }

  override async claim(commandValue: LocalCommand, receivedAt: string): Promise<CommandClaim> {
    this.#reportClaimStarted?.()
    this.#reportClaimStarted = null
    await new Promise<void>(resolve => { this.#releaseClaim = resolve })
    return super.claim(commandValue, receivedAt)
  }

  release(): void {
    this.#releaseClaim?.()
    this.#releaseClaim = null
  }
}

function createHarness(
  overrides: Partial<CapabilityContext> = {},
  options: Readonly<{
    clock?: () => Date
    commandRepository?: MemoryCommandRepository
    observe?: StatusProbe['observe']
  }> = {},
) {
  let executions = 0
  const statusProbe: StatusProbe = {
    observe: async signal => {
      executions += 1
      if (options.observe !== undefined) return options.observe(signal)
      return {
        battery: { availability: 'unavailable', reason: 'fixture' },
        network: { availability: 'unavailable', reason: 'fixture' },
        observedAt: '2026-08-19T00:00:01.000Z',
        platform: 'android',
      }
    },
  }
  const registry = new CapabilityRegistry()
  registry.register(createStatusCapability(statusProbe))
  const commandRepository = options.commandRepository ?? new MemoryCommandRepository()
  const auditRepository = new MemoryAuditRepository()
  const executor = new LocalCommandExecutor({
    auditRepository,
    clock: options.clock ?? (() => new Date('2026-08-19T00:00:01.000Z')),
    commandRepository,
    context: async () => ({ ...context, ...overrides }),
    idGenerator: () => `audit_${auditRepository.records.length + 1}`,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return {
    auditRepository,
    commandRepository,
    executor,
    executions: () => executions,
  }
}

describe('local runtime contract', () => {
  test('10,000 次重复 commandId 只执行一次并回放首次结果', async () => {
    const harness = createHarness()
    const outcomes = []
    for (let index = 0; index < 10_000; index += 1) {
      outcomes.push(await harness.executor.execute(command, new AbortController().signal))
    }

    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    expect(harness.executions()).toBe(1)
    expect(harness.commandRepository.records.size).toBe(1)
  })

  test('100 个并发重复 commandId 共享同一个执行结果', async () => {
    const harness = createHarness()
    const outcomes = await Promise.all(Array.from({ length: 100 }, () => (
      harness.executor.execute(command, new AbortController().signal)
    )))

    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    expect(harness.executions()).toBe(1)
    expect(new Set(outcomes.map(outcome => JSON.stringify(outcome))).size).toBe(1)
  })

  test('Disabled、过期和未知参数都不会进入 handler', async () => {
    const disabled = createHarness({ controlMode: 'disabled', reachability: 'disabled' })
    await expect(disabled.executor.execute(command, new AbortController().signal))
      .resolves.toMatchObject({ error: { code: 'disabled' }, ok: false })
    expect(disabled.executions()).toBe(0)

    const expired = createHarness()
    await expect(expired.executor.execute(
      { ...command, commandId: 'expired', expiresAt: '2026-08-18T23:59:59.000Z' },
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'expired' }, ok: false })
    expect(expired.executions()).toBe(0)

    const invalid = createHarness()
    await expect(invalid.executor.execute(
      { ...command, arguments: { unexpected: true }, commandId: 'invalid' },
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'invalid_argument' }, ok: false })
    expect(invalid.executions()).toBe(0)
  })

  test('SQLite claim 等待期间取消后保存终态且不进入 handler', async () => {
    const commandRepository = new DelayedClaimRepository()
    const harness = createHarness({}, { commandRepository })
    const abortController = new AbortController()
    const execution = harness.executor.execute(
      { ...command, commandId: 'cancelled_during_claim' },
      abortController.signal,
    )

    await commandRepository.claimStarted
    abortController.abort()
    commandRepository.release()

    await expect(execution).resolves.toMatchObject({ error: { code: 'cancelled' }, ok: false })
    expect(harness.executions()).toBe(0)
    expect(commandRepository.records.get('cancelled_during_claim')).toMatchObject({
      status: 'cancelled',
    })
  })

  test('SQLite claim 等待期间到期后保存终态且不进入 handler', async () => {
    let now = new Date('2026-08-19T00:00:00.000Z')
    const commandRepository = new DelayedClaimRepository()
    const harness = createHarness({}, { clock: () => now, commandRepository })
    const execution = harness.executor.execute({
      ...command,
      commandId: 'expired_during_claim',
      expiresAt: '2026-08-19T00:00:01.000Z',
    }, new AbortController().signal)

    await commandRepository.claimStarted
    now = new Date('2026-08-19T00:00:02.000Z')
    commandRepository.release()

    await expect(execution).resolves.toMatchObject({ error: { code: 'expired' }, ok: false })
    expect(harness.executions()).toBe(0)
    expect(commandRepository.records.get('expired_during_claim')).toMatchObject({
      status: 'expired',
    })
  })

  test('emergency disable 可取消所有执行中的本地 handler 并保存 cancelled 终态', async () => {
    let reportStarted: (() => void) | null = null
    const started = new Promise<void>(resolve => { reportStarted = resolve })
    const harness = createHarness({}, {
      observe: signal => new Promise((_resolve, reject) => {
        reportStarted?.()
        reportStarted = null
        signal.addEventListener('abort', () => {
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }),
    })
    const execution = harness.executor.execute(
      { ...command, commandId: 'cancel_all_running' },
      new AbortController().signal,
    )

    await started
    expect(harness.executor.cancelAll()).toBe(1)
    await expect(execution).resolves.toMatchObject({ error: { code: 'cancelled' }, ok: false })
    expect(harness.commandRepository.records.get('cancel_all_running')).toMatchObject({
      status: 'cancelled',
    })
    expect(harness.executor.cancelAll()).toBe(0)
  })

  test('超过 capability inline 结果字节上限时不把大值写入 command store', async () => {
    const oversizedReason = `oversized_${'界'.repeat(6_000)}`
    const harness = createHarness({}, {
      observe: async () => ({
        battery: { availability: 'unavailable', reason: oversizedReason },
        network: { availability: 'unavailable', reason: 'fixture' },
        observedAt: '2026-08-19T00:00:01.000Z',
        platform: 'android',
      }),
    })

    await expect(harness.executor.execute(
      { ...command, commandId: 'oversized_result' },
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'result_too_large' }, ok: false })
    const stored = harness.commandRepository.records.get('oversized_result')
    expect(stored?.status).toBe('failed')
    expect(JSON.stringify(stored)).not.toContain(oversizedReason)
  })

  test('损坏的 command envelope 在持久化前被拒绝', async () => {
    const harness = createHarness()
    await expect(harness.executor.execute(
      { ...command, commandId: '', unexpected: 'field' },
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'invalid_argument' }, ok: false })
    await expect(harness.executor.execute(
      { ...command, caller: { displayName: '可信调用方\u202eexe.txt', subjectId: 'caller_key_01' } },
      new AbortController().signal,
    )).resolves.toMatchObject({ error: { code: 'invalid_argument' }, ok: false })
    expect(harness.commandRepository.records.size).toBe(0)
    expect(harness.executions()).toBe(0)
  })

  test('crash recovery 标记结果未知且绝不自动重放', async () => {
    const harness = createHarness()
    await harness.commandRepository.claim(command, '2026-08-19T00:00:00.000Z')
    await expect(harness.commandRepository.recoverInterrupted('2026-08-19T00:00:01.000Z'))
      .resolves.toBe(1)
    await expect(harness.executor.execute(command, new AbortController().signal))
      .resolves.toMatchObject({ error: { code: 'result_unknown' }, ok: false })
    expect(harness.executions()).toBe(0)
  })

  test('审计只包含元数据，不包含完整 arguments', async () => {
    const harness = createHarness()
    await harness.executor.execute(command, new AbortController().signal)
    expect(harness.auditRepository.records[0]).toMatchObject({
      callerSubjectId: 'caller_key_01',
      commandId: 'command_01',
      decision: 'allowed',
      path: 'phone/status',
      tool: 'get',
    })
    expect(JSON.stringify(harness.auditRepository.records[0])).not.toContain('arguments')
  })
})
