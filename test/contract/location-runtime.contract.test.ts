import { CurrentLocationController } from '@/capabilities/location/controller'
import { createCurrentLocationCapability } from '@/capabilities/location/locationCapability'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type {
  CurrentLocationAdapter,
  ForegroundLocationPermission,
} from '@/capabilities/location/locationAdapter'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'trusted_session',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

function createHarness() {
  let acquisitions = 0
  let permissionRequests = 0
  let permission: ForegroundLocationPermission = {
    accuracy: 'unknown',
    canAskAgain: true,
    status: 'undetermined',
  }
  const adapter: CurrentLocationAdapter = {
    current: async () => {
      acquisitions += 1
      return {
        accuracyMeters: 150,
        latitude: 31.2304,
        longitude: 121.4737,
        mocked: null,
        timestampMs: Date.parse('2026-08-19T00:00:02.000Z'),
      }
    },
    getPermission: async () => permission,
    requestPermission: async () => {
      permissionRequests += 1
      permission = { accuracy: 'approximate', canAskAgain: true, status: 'granted' }
      return permission
    },
    servicesEnabled: async () => true,
  }
  const registry = new CapabilityRegistry()
  registry.register(createCurrentLocationCapability(new CurrentLocationController(
    adapter,
    () => new Date('2026-08-19T00:00:03.000Z'),
  )))
  const auditRepository = new MemoryAuditRepository()
  const confirmations = new LocalConfirmationCoordinator({
    clock: () => new Date('2026-08-19T00:00:01.000Z'),
  })
  const executor = new LocalCommandExecutor({
    auditRepository,
    clock: () => new Date('2026-08-19T00:00:01.000Z'),
    commandRepository: new MemoryCommandRepository(),
    confirmationCoordinator: confirmations,
    context: async () => context,
    policyEngine: new PolicyEngine(),
    registry,
  })
  return {
    acquisitions: () => acquisitions,
    auditRepository,
    confirmations,
    executor,
    permissionRequests: () => permissionRequests,
  }
}

const command: LocalCommand = {
  arguments: { accuracy: 'balanced', purpose: '查找附近门店', timeoutSeconds: 15 },
  caller: { displayName: 'Fixture Caller', subjectId: 'caller_a' },
  commandId: 'location_command',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T01:00:00.000Z',
  path: 'phone/location',
  tool: 'current',
}

describe('location local runtime contract', () => {
  test('高风险确认前不请求系统权限；允许一次后只采集一次', async () => {
    const harness = createHarness()
    const outcome = harness.executor.execute(command, new AbortController().signal)
    await new Promise<void>(resolve => { setImmediate(resolve) })

    expect(harness.permissionRequests()).toBe(0)
    expect(harness.acquisitions()).toBe(0)
    expect(harness.confirmations.getPending()[0]).toMatchObject({
      callerDisplayName: 'Fixture Caller',
      details: expect.arrayContaining([
        { label: '用途', value: '查找附近门店' },
        { label: '期望精度', value: 'balanced' },
      ]),
      risk: 'high',
    })
    harness.confirmations.approve(command.commandId)
    await expect(outcome).resolves.toMatchObject({
      ok: true,
      value: {
        capturedAt: '2026-08-19T00:00:02.000Z',
        horizontalAccuracyMeters: 150,
        permissionAccuracy: 'approximate',
      },
    })
    expect(harness.permissionRequests()).toBe(1)
    expect(harness.acquisitions()).toBe(1)
    expect(JSON.stringify(harness.auditRepository.records)).not.toContain('31.2304')
    expect(JSON.stringify(harness.auditRepository.records)).not.toContain('121.4737')
  })

  test('用户拒绝本地确认不请求权限、不采集位置且不是成功', async () => {
    const harness = createHarness()
    const outcome = harness.executor.execute(
      { ...command, commandId: 'location_rejected' },
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    harness.confirmations.reject('location_rejected')

    await expect(outcome).resolves.toMatchObject({
      error: { code: 'user_rejected' },
      ok: false,
    })
    expect(harness.permissionRequests()).toBe(0)
    expect(harness.acquisitions()).toBe(0)
  })
})
