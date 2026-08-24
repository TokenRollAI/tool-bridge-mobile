import {
  cameraCaptureArgumentsSchema,
  cameraCaptureResultSchema,
} from './schema'

import type { CameraCaptureController } from './controller'
import type {
  CameraCaptureArguments,
  CameraCaptureResult,
} from './schema'
import type { MobileCapability } from '@/capabilities/types'

export function createCameraCaptureCapability(
  controller: CameraCaptureController,
): MobileCapability<CameraCaptureArguments, CameraCaptureResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '用途',
      value: argumentsValue.purpose,
    }, {
      label: '摄像头',
      value: argumentsValue.facing === 'front' ? '前置' : '后置',
    }, {
      label: '质量',
      value: argumentsValue.quality,
    }],
    descriptor: {
      confirmation: 'always',
      description: '仅在前台展示可见预览并拍摄一张照片；直接调用模式会在预览就绪后自动拍摄',
      effect: 'write',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 4, maxPerCaller: 2, windowSeconds: 60 },
      },
      path: 'phone/camera',
      queuePolicy: 'reject_offline',
      risk: 'high',
      tool: 'capture_photo',
    },
    execute: (argumentsValue, context, invocation, signal) => (
      controller.capture(argumentsValue, context, invocation, signal)
    ),
    inputSchema: cameraCaptureArgumentsSchema,
    outputSchema: cameraCaptureResultSchema,
    probe: context => controller.probe(context.appState),
  }
}
