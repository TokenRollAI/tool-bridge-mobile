import { InboxDeliveryController } from './controller'
import {
  inboxDeliveryArgumentsSchema,
  inboxDeliveryResultSchema,
} from './schema'

import type { InboxDeliveryArguments, InboxDeliveryResult } from './schema'
import type { MobileCapability } from '@/capabilities/types'

export function createInboxDeliveryCapability(
  controller: InboxDeliveryController,
): MobileCapability<InboxDeliveryArguments, InboxDeliveryResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '标题',
      value: argumentsValue.title,
    }, {
      label: '类型',
      value: argumentsValue.category,
    }, {
      label: '紧急程度',
      value: argumentsValue.urgency,
    }, {
      label: '本地通知',
      value: argumentsValue.notify ? '请求' : '不请求',
    }],
    descriptor: {
      confirmation: 'never',
      description: '把一条有界 Markdown 消息保存到这台设备的本地信箱，可选请求固定内容的本地通知',
      effect: 'write',
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 3_600 },
      },
      path: 'phone/inbox',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'deliver',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.deliver(argumentsValue, invocation, signal)
    ),
    inputSchema: inboxDeliveryArgumentsSchema,
    outputSchema: inboxDeliveryResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}
