import {
  createCanOpenUrlCapability,
  createOpenUrlCapability,
} from '@/capabilities/apps/appsCapabilities'
import { AppHandoffController } from '@/capabilities/apps/controller'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type { AppLinkingAdapter } from '@/capabilities/apps/linkingAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

function createHarness() {
  let opens = 0
  const clock = () => new Date('2026-08-19T00:00:01.000Z')
  const adapter: AppLinkingAdapter = {
    canOpen: async () => true,
    open: async () => { opens += 1 },
    probe: () => true,
  }
  const controller = new AppHandoffController(adapter, new Set(['www.example.com']), clock)
  const registry = new CapabilityRegistry()
  registry.register(createCanOpenUrlCapability(controller))
  registry.register(createOpenUrlCapability(controller))
  const confirmations = new LocalConfirmationCoordinator({
    clock,
  })
  const executor = new LocalCommandExecutor({
    auditRepository: new MemoryAuditRepository(),
    clock,
    commandRepository: new MemoryCommandRepository(),
    confirmationCoordinator: confirmations,
    context: async () => context,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return { confirmations, executor, opens: () => opens }
}

function command(tool: 'can_open_url' | 'open_url', commandId: string): LocalCommand {
  return {
    arguments: { url: 'https://www.example.com/path?ticket=secret' },
    caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
    commandId,
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    path: 'phone/apps',
    tool,
  }
}

describe('apps local runtime contract', () => {
  test('can_open_url 无副作用，open_url 单次确认后只返回 handed_off', async () => {
    const harness = createHarness()
    await expect(harness.executor.execute(
      command('can_open_url', 'can_open_command'),
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: {
        canOpen: true,
        target: { host: 'www.example.com', kind: 'https' },
      },
    })
    expect(harness.opens()).toBe(0)

    const opened = harness.executor.execute(
      command('open_url', 'open_command'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(harness.confirmations.getPending()[0]).toMatchObject({
      details: [{ label: '目标 hostname', value: 'www.example.com' }],
    })
    harness.confirmations.approve('open_command')
    await expect(opened).resolves.toEqual({
      ok: true,
      value: {
        status: 'handed_off',
        target: { host: 'www.example.com', kind: 'https' },
      },
    })
    expect(harness.opens()).toBe(1)
  })

  test('未授权 URL 在确认提示前被拒绝', async () => {
    const harness = createHarness()
    const outcome = await harness.executor.execute({
      ...command('open_url', 'bad_open_command'),
      arguments: { url: 'https://attacker.example/path' },
    }, new AbortController().signal)

    expect(outcome).toMatchObject({ error: { code: 'url_not_allowed' }, ok: false })
    expect(harness.confirmations.getPending()).toEqual([])
    expect(harness.opens()).toBe(0)
  })
})
