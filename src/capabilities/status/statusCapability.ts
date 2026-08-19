
import { statusArgumentsSchema } from './schema'

import type { StatusProbe } from './probe'
import type { StatusArguments, StatusResult } from './schema'
import type { MobileCapability } from '@/capabilities/types'

export function createStatusCapability(
  statusProbe: StatusProbe,
): MobileCapability<StatusArguments, StatusResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '返回设备本地可观察状态；不可读取的字段明确标记 unavailable',
      effect: 'read',
      limits: {
        maxResultBytes: 16_384,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/status',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'get',
    },
    execute: async (_argumentsValue, context, _invocation, signal) => ({
      ...await statusProbe.observe(signal),
      appState: context.appState,
      controlMode: context.controlMode,
      installationId: context.installationId,
      reachability: context.reachability,
    }),
    inputSchema: statusArgumentsSchema,
    probe: async () => ({ status: 'available' }),
  }
}
