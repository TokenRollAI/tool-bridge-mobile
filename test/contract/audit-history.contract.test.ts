import { z } from 'zod'

import { CapabilityRegistry } from '@/capabilities/registry'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type { MobileCapability } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const command: LocalCommand = {
  arguments: { secret: '正文不得进入审计' },
  caller: { subjectId: 'caller_audit_contract' },
  commandId: 'audit_clear_replay_01',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T01:00:00.000Z',
  path: 'phone/test',
  tool: 'side_effect',
}

describe('audit history contract', () => {
  test('清除审计不删除 command 防重放记录，同 commandId 不会再次产生副作用', async () => {
    let sideEffects = 0
    const capability: MobileCapability<{ secret: string }, { status: 'committed' }> = {
      descriptor: {
        confirmation: 'never',
        description: '审计清除防重放契约夹具',
        effect: 'write',
        limits: {
          maxResultBytes: 1_024,
          rate: { maxGlobal: 10, maxPerCaller: 10, windowSeconds: 60 },
        },
        path: command.path,
        queuePolicy: 'reject_offline',
        risk: 'low',
        tool: command.tool,
      },
      execute: async () => {
        sideEffects += 1
        return { status: 'committed' }
      },
      inputSchema: z.strictObject({ secret: z.string() }),
      probe: async () => ({ status: 'available' }),
    }
    const registry = new CapabilityRegistry()
    registry.register(capability)
    const auditRepository = new MemoryAuditRepository()
    const commandRepository = new MemoryCommandRepository()
    let auditSequence = 0
    const executor = new LocalCommandExecutor({
      auditRepository,
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
      commandRepository,
      context: async () => ({
        appState: 'active',
        controlMode: 'trusted_session',
        installationId: 'installation_00000000-0000-4000-8000-000000000000',
        reachability: 'unconfigured',
      }),
      idGenerator: () => `audit_${++auditSequence}`,
      policyEngine: new PolicyEngine(),
      registry,
    })

    await expect(executor.execute(command, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: { status: 'committed' } })
    expect(sideEffects).toBe(1)
    expect(JSON.stringify(auditRepository.records)).not.toContain('正文不得进入审计')
    await expect(auditRepository.clear()).resolves.toBe(1)
    expect(auditRepository.records).toEqual([])
    expect(commandRepository.records.has(command.commandId)).toBe(true)

    await expect(executor.execute(command, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: { status: 'committed' } })
    expect(sideEffects).toBe(1)
    expect(commandRepository.records.size).toBe(1)
    expect(auditRepository.records).toHaveLength(1)
    expect(auditRepository.records[0]).toMatchObject({
      commandId: command.commandId,
      decision: 'replayed',
    })
  })

  test('clear 线性化后新增的审计会保留，重复 clear 返回零', async () => {
    const repository = new MemoryAuditRepository()
    const first = {
      callerSubjectId: 'caller', clientVersion: '0.1.0', commandId: 'one',
      decision: 'allowed' as const, effect: 'read' as const, id: 'audit_one',
      occurredAt: '2026-08-19T00:00:01.000Z', outcomeCode: 'succeeded',
      path: 'phone/status', risk: 'low' as const, tool: 'get',
    }
    await repository.add(first)
    await expect(repository.clear()).resolves.toBe(1)
    await repository.add({ ...first, commandId: 'two', id: 'audit_two' })
    expect(repository.records.map(record => record.id)).toEqual(['audit_two'])
    await expect(repository.clear()).resolves.toBe(1)
    await expect(repository.clear()).resolves.toBe(0)
  })
})
