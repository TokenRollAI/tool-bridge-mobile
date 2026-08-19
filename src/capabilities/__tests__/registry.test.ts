import { z } from 'zod'

import { CapabilityRegistry } from '../registry'

import type { CapabilityContext, MobileCapability } from '../types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'trusted_session',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

describe('CapabilityRegistry', () => {
  test('单个 native probe 抛错时隔离为 unavailable，不拖垮 snapshot 或执行前检查', async () => {
    const capability: MobileCapability<Record<string, never>, null> = {
      descriptor: {
        confirmation: 'never',
        description: 'failing probe fixture',
        effect: 'read',
        limits: {
          maxResultBytes: 1_024,
          rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
        },
        path: 'phone/fixture',
        queuePolicy: 'reject_offline',
        risk: 'low',
        tool: 'get',
      },
      execute: async () => null,
      inputSchema: z.strictObject({}),
      probe: async () => { throw new Error('native detail must not escape') },
    }
    const registry = new CapabilityRegistry()
    registry.register(capability)

    await expect(registry.snapshot(context)).resolves.toEqual([{
      availability: { reason: 'probe_failed', status: 'unavailable' },
      descriptor: capability.descriptor,
    }])
    await expect(registry.resolve('phone/fixture', 'get')?.probe(context)).resolves.toEqual({
      reason: 'probe_failed',
      status: 'unavailable',
    })
  })

  test('拒绝不安全的 capability execution limits', () => {
    const registry = new CapabilityRegistry()
    expect(() => registry.register({
      descriptor: {
        confirmation: 'never',
        description: 'invalid limits fixture',
        effect: 'read',
        limits: {
          maxResultBytes: 0,
          rate: { maxGlobal: 1, maxPerCaller: 2, windowSeconds: 0 },
        },
        path: 'phone/fixture',
        queuePolicy: 'reject_offline',
        risk: 'low',
        tool: 'invalid',
      },
      execute: async () => null,
      inputSchema: z.strictObject({}),
      probe: async () => ({ status: 'available' }),
    })).toThrow('能力 limits 无效')
  })
})
