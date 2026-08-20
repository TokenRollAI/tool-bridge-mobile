import { ToolExecutionError } from '@/capabilities/types'

import ToolBridgeAttentionModule from '../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule'

import type { ToolBridgeAttentionNativeModule } from '../../../modules/tool-bridge-attention/src/ToolBridgeAttention.types'

export interface AttentionFlashAdapter {
  disable(): Promise<void>
  enable(): Promise<boolean>
  probe(): Promise<boolean>
}

// 通过设备闪光灯 torch 提供视觉提示。torch 控制不请求相机权限、不打开采集流；
// probe 只在存在带闪光灯硬件时返回可用，无硬件或被占用时诚实返回不可用。
export class NativeAttentionFlashAdapter implements AttentionFlashAdapter {
  constructor(
    private readonly nativeModule: ToolBridgeAttentionNativeModule = ToolBridgeAttentionModule,
  ) {}

  async disable(): Promise<void> {
    try {
      await this.nativeModule.disableTorchAsync()
    } catch {
      throw new ToolExecutionError(
        'native_failure',
        '设备提示原生模块关闭闪光灯失败',
        false,
      )
    }
  }

  async enable(): Promise<boolean> {
    try {
      return await this.nativeModule.enableTorchAsync()
    } catch {
      // torch 被其他 App 占用或系统拒绝时视为本次通道不可用，不视为整体失败。
      return false
    }
  }

  async probe(): Promise<boolean> {
    try {
      return await this.nativeModule.probeTorchAsync()
    } catch {
      throw new ToolExecutionError(
        'native_failure',
        '设备提示原生模块探测闪光灯失败',
        false,
      )
    }
  }
}
