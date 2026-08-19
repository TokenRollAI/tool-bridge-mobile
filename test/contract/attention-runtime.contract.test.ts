import { createAttentionRingCapability } from '@/capabilities/attention/attentionCapabilities'
import { AttentionSessionController } from '@/capabilities/attention/controller'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type { AttentionHapticsAdapter } from '@/capabilities/attention/hapticsAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'trusted_session',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

const command: LocalCommand = {
  arguments: { durationSeconds: 30 },
  caller: { subjectId: 'caller_key_01' },
  commandId: 'attention_command_01',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T01:00:00.000Z',
  path: 'phone/attention',
  tool: 'ring',
}

describe('attention local runtime contract', () => {
  test('100 次重复 commandId 只创建同一个 attention session', async () => {
    let pulses = 0
    const haptics: AttentionHapticsAdapter = {
      cancel: async () => undefined,
      probe: async () => true,
      pulse: async () => { pulses += 1; return true },
    }
    const controller = new AttentionSessionController(haptics, {
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
      idGenerator: () => '00000000-0000-4000-8000-000000000001',
      pulseIntervalMs: 60_000,
    })
    const registry = new CapabilityRegistry()
    registry.register(createAttentionRingCapability(controller))
    const executor = new LocalCommandExecutor({
      auditRepository: new MemoryAuditRepository(),
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
      commandRepository: new MemoryCommandRepository(),
      context: async () => context,
      idGenerator: () => 'audit_fixture',
      policyEngine: new PolicyEngine(),
      registry,
    })

    const outcomes = []
    for (let index = 0; index < 100; index += 1) {
      outcomes.push(await executor.execute(command, new AbortController().signal))
    }

    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    expect(new Set(outcomes.map(outcome => JSON.stringify(outcome))).size).toBe(1)
    expect(pulses).toBe(1)
    await controller.stop()
  })

  test('attention admission 在本地确认前限制唯一 command 洪泛', async () => {
    const haptics: AttentionHapticsAdapter = {
      cancel: async () => undefined,
      probe: async () => true,
      pulse: async () => true,
    }
    const registry = new CapabilityRegistry()
    registry.register(createAttentionRingCapability(new AttentionSessionController(haptics)))
    const confirmations = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
    })
    const executor = new LocalCommandExecutor({
      auditRepository: new MemoryAuditRepository(),
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
      commandRepository: new MemoryCommandRepository(),
      confirmationCoordinator: confirmations,
      context: async () => ({ ...context, controlMode: 'ask_every_time' }),
      policyEngine: new PolicyEngine(),
      registry,
    })
    const pending = Array.from({ length: 3 }, (_, index) => executor.execute({
      ...command,
      commandId: `attention_pending_${index}`,
    }, new AbortController().signal))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(confirmations.getPending()).toHaveLength(3)

    await expect(executor.execute({
      ...command,
      commandId: 'attention_rate_limited_before_confirmation',
    }, new AbortController().signal)).resolves.toMatchObject({
      error: { code: 'rate_limited' },
      ok: false,
    })
    expect(confirmations.getPending()).toHaveLength(3)
    confirmations.rejectAll('disabled')
    await Promise.all(pending)
  })
})
