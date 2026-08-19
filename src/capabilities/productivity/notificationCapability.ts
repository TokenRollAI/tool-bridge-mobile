import {
  localNotificationArgumentsSchema,
  localNotificationResultSchema,
} from './notificationSchema'

import type {
  LocalNotificationController,
  LocalNotificationResult,
} from './notificationController'
import type { LocalNotificationArguments } from './notificationSchema'
import type { MobileCapability } from '@/capabilities/types'

export function createLocalNotificationCapability(
  controller: LocalNotificationController,
): MobileCapability<LocalNotificationArguments, LocalNotificationResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '用途',
      value: argumentsValue.purpose,
    }, {
      label: '通知正文',
      value: argumentsValue.message,
    }],
    descriptor: {
      confirmation: 'when_locked',
      description: '在用户已授权的系统 channel 中创建可见的即时本地通知',
      effect: 'write',
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
      },
      path: 'phone/productivity',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'notify',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.notify(argumentsValue, invocation, signal)
    ),
    inputSchema: localNotificationArgumentsSchema,
    outputSchema: localNotificationResultSchema,
    probe: context => controller.probe(context.appState),
  }
}
