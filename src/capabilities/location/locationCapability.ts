import { currentLocationArgumentsSchema, currentLocationResultSchema } from './schema'

import type { CurrentLocationController, CurrentLocationResult } from './controller'
import type { CurrentLocationArguments } from './schema'
import type { MobileCapability } from '@/capabilities/types'

export function createCurrentLocationCapability(
  controller: CurrentLocationController,
): MobileCapability<CurrentLocationArguments, CurrentLocationResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '用途',
      value: argumentsValue.purpose,
    }, {
      label: '期望精度',
      value: argumentsValue.accuracy,
    }, {
      label: '最长等待',
      value: `${argumentsValue.timeoutSeconds} 秒`,
    }],
    descriptor: {
      confirmation: 'always',
      description: '在前台确认后采集一次当前位置；不启动后台或持续定位',
      effect: 'read',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 12, maxPerCaller: 6, windowSeconds: 60 },
      },
      path: 'phone/location',
      queuePolicy: 'reject_offline',
      risk: 'high',
      tool: 'current',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.current(argumentsValue, signal, invocation.expiresAt)
    ),
    inputSchema: currentLocationArgumentsSchema,
    outputSchema: currentLocationResultSchema,
    probe: context => controller.probe(context.appState),
  }
}
