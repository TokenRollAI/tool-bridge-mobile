import { z } from 'zod'

import { appUrlArgumentsSchema } from '../apps/schema'
import { ringArgumentsSchema, stopArgumentsSchema } from '../attention/schema'
import { openMapArgumentsSchema } from '../location/openMapSchema'
import { currentLocationArgumentsSchema } from '../location/schema'
import { mediaPlayArgumentsSchema, mediaSessionArgumentsSchema } from '../media/schema'
import { localNotificationArgumentsSchema } from '../productivity/notificationSchema'
import {
  timerReferenceArgumentsSchema,
  timerStartArgumentsSchema,
} from '../productivity/timerSchema'
import { CapabilityRegistry } from '../registry'
import { statusArgumentsSchema } from '../status/schema'

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

  test('把本地 registry 投影为官方 SDK DeviceExpose，不制造额外 wire 字段', () => {
    const registry = new CapabilityRegistry()
    registry.register({
      descriptor: {
        confirmation: 'always',
        description: 'fixture write capability',
        effect: 'write',
        limits: {
          maxResultBytes: 1_024,
          rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
        },
        path: 'phone/fixture',
        queuePolicy: 'reject_offline',
        risk: 'medium',
        tool: 'write',
      },
      execute: async () => ({ ok: true }),
      inputSchema: z.strictObject({ count: z.number().int().min(1).max(3) }),
      probe: async () => ({ status: 'available' }),
    })

    expect(registry.deviceExpose()).toEqual({
      nodes: [{
        cmds: [{
          confirm: true,
          description: 'fixture write capability',
          effect: 'write',
          inputSchema: expect.objectContaining({
            additionalProperties: false,
            properties: {
              count: expect.objectContaining({ maximum: 3, minimum: 1, type: 'integer' }),
            },
            required: ['count'],
            type: 'object',
          }),
          name: 'write',
        }],
        description: 'Tool Bridge Mobile phone/fixture capabilities',
        kind: 'tool',
        path: 'phone/fixture',
      }],
    })
  })

  test('所有当前公开 capability input schema 都可投影为 SDK JSON Schema', () => {
    const schemas = [
      appUrlArgumentsSchema,
      currentLocationArgumentsSchema,
      localNotificationArgumentsSchema,
      mediaPlayArgumentsSchema,
      mediaSessionArgumentsSchema,
      openMapArgumentsSchema,
      ringArgumentsSchema,
      statusArgumentsSchema,
      stopArgumentsSchema,
      timerReferenceArgumentsSchema,
      timerStartArgumentsSchema,
    ]

    for (const schema of schemas) {
      expect(z.toJSONSchema(schema)).toMatchObject({
        additionalProperties: false,
        type: 'object',
      })
    }
  })
})
