import { ToolExecutionError } from '@/capabilities/types'

import ToolBridgeAttentionModule from '../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule'

import type { ToolBridgeAttentionNativeModule } from '../../../modules/tool-bridge-attention/src/ToolBridgeAttention.types'

export interface AttentionHapticsAdapter {
  cancel(): Promise<void>
  probe(): Promise<boolean>
  pulse(): Promise<boolean>
}

export class NativeAttentionHapticsAdapter implements AttentionHapticsAdapter {
  constructor(
    private readonly nativeModule: ToolBridgeAttentionNativeModule = ToolBridgeAttentionModule,
  ) {}

  async cancel(): Promise<void> {
    try {
      await this.nativeModule.cancelAsync()
    } catch {
      throw new ToolExecutionError(
        'native_failure',
        '设备提示原生模块停止失败',
        false,
      )
    }
  }

  async probe(): Promise<boolean> {
    try {
      return await this.nativeModule.probeHapticsAsync()
    } catch {
      throw new ToolExecutionError(
        'native_failure',
        '设备提示原生模块探测失败',
        false,
      )
    }
  }

  async pulse(): Promise<boolean> {
    try {
      return await this.nativeModule.pulseAsync()
    } catch {
      throw new ToolExecutionError(
        'native_failure',
        '设备提示原生模块执行失败',
        false,
      )
    }
  }
}
