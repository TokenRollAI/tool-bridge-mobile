import { createOpenMapCapability } from '@/capabilities/location/openMapCapability'
import { OpenMapController } from '@/capabilities/location/openMapController'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type { MapHandoffAdapter } from '@/capabilities/location/mapHandoffAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const activeContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

function createHarness(context: CapabilityContext = activeContext) {
  let opens = 0
  const openedUris: string[] = []
  const adapter: MapHandoffAdapter = {
    canOpen: async () => true,
    open: async uri => { opens += 1; openedUris.push(uri) },
    platform: () => 'android',
    probe: () => true,
  }
  const clock = () => new Date('2026-08-19T00:00:01.000Z')
  const registry = new CapabilityRegistry()
  registry.register(createOpenMapCapability(new OpenMapController(adapter, clock)))
  const confirmations = new LocalConfirmationCoordinator({ clock })
  const auditRepository = new MemoryAuditRepository()
  const executor = new LocalCommandExecutor({
    auditRepository,
    clock,
    commandRepository: new MemoryCommandRepository(),
    confirmationCoordinator: confirmations,
    context: async () => context,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return { auditRepository, confirmations, executor, openedUris, opens: () => opens }
}

function command(commandId: string): LocalCommand {
  return {
    arguments: {
      purpose: '查看会面地点',
      target: { kind: 'query', query: 'Sensitive Street 123' },
    },
    caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
    commandId,
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    path: 'phone/location',
    tool: 'open_map',
  }
}

describe('open_map local runtime contract', () => {
  test('确认页展示目标/provider，批准后只返回脱敏 handed_off', async () => {
    const harness = createHarness()
    const pending = harness.executor.execute(command('map_approved'), new AbortController().signal)
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(harness.opens()).toBe(0)
    expect(harness.confirmations.getPending()[0]).toMatchObject({
      details: [{ label: '用途', value: '查看会面地点' }, {
        label: '地图目标', value: 'Sensitive Street 123',
      }, {
        label: '系统处理器', value: 'android_geo_handler',
      }],
      path: 'phone/location',
      tool: 'open_map',
    })

    harness.confirmations.approve('map_approved')
    const outcome = await pending
    expect(outcome).toEqual({
      ok: true,
      value: {
        status: 'handed_off',
        target: { kind: 'map', provider: 'android_geo_handler' },
      },
    })
    expect(JSON.stringify(outcome)).not.toContain('Sensitive')
    expect(harness.opens()).toBe(1)
    expect(JSON.stringify(await harness.auditRepository.listRecent(10))).not.toContain('Sensitive')
  })

  test('拒绝、Disabled 和后台均不 handoff', async () => {
    const rejectedHarness = createHarness()
    const rejected = rejectedHarness.executor.execute(
      command('map_rejected'),
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    rejectedHarness.confirmations.reject('map_rejected')
    await expect(rejected).resolves.toMatchObject({ error: { code: 'user_rejected' }, ok: false })
    expect(rejectedHarness.opens()).toBe(0)

    for (const context of [
      { ...activeContext, controlMode: 'disabled' as const, reachability: 'disabled' as const },
      { ...activeContext, appState: 'background' as const },
    ]) {
      const harness = createHarness(context)
      await expect(harness.executor.execute(
        command(`map_${context.controlMode}_${context.appState}`),
        new AbortController().signal,
      )).resolves.toMatchObject({ ok: false })
      expect(harness.opens()).toBe(0)
      expect(harness.confirmations.getPending()).toEqual([])
    }
  })

  test('100 个并发重复 commandId 只触发一次系统 handoff', async () => {
    const harness = createHarness()
    const outcomes = Array.from({ length: 100 }, () => harness.executor.execute(
      command('map_replayed'),
      new AbortController().signal,
    ))
    await new Promise<void>(resolve => { setImmediate(resolve) })
    harness.confirmations.approve('map_replayed')

    await expect(Promise.all(outcomes)).resolves.toHaveLength(100)
    expect(harness.opens()).toBe(1)
    expect(harness.openedUris).toEqual(['geo:0,0?q=Sensitive%20Street%20123'])
  })
})
