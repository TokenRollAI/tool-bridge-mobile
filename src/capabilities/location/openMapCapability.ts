import { summarizeMapTarget } from './mapTargetBuilder'
import { openMapArgumentsSchema } from './openMapSchema'

import type { OpenMapController, OpenMapResult } from './openMapController'
import type { OpenMapArguments } from './openMapSchema'
import type { MobileCapability } from '@/capabilities/types'

export function createOpenMapCapability(
  controller: OpenMapController,
): MobileCapability<OpenMapArguments, OpenMapResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '用途',
      value: argumentsValue.purpose,
    }, {
      label: '地图目标',
      value: summarizeMapTarget(argumentsValue.target),
    }, {
      label: '系统处理器',
      value: controller.provider() ?? 'unsupported',
    }],
    descriptor: {
      confirmation: 'always',
      description: '把结构化地址或坐标交给用户可见的系统地图处理器',
      effect: 'write',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 20, maxPerCaller: 10, windowSeconds: 60 },
      },
      path: 'phone/location',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'open_map',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.open(argumentsValue, signal, invocation.expiresAt)
    ),
    inputSchema: openMapArgumentsSchema,
    probe: context => controller.probe(context.appState),
  }
}
