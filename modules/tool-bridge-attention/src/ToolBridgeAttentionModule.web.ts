import { NativeModule, registerWebModule } from 'expo'

import type { ToolBridgeCameraFacing } from './ToolBridgeAttention.types'

class ToolBridgeAttentionModule extends NativeModule {
  async cancelAsync(): Promise<void> {}

  async disableTorchAsync(): Promise<void> {}

  async enableTorchAsync(): Promise<boolean> {
    return false
  }

  async getAvailableCameraFacingsAsync(): Promise<readonly ToolBridgeCameraFacing[]> {
    return []
  }

  async probeHapticsAsync(): Promise<boolean> {
    return false
  }

  async probeTorchAsync(): Promise<boolean> {
    return false
  }

  async pulseAsync(): Promise<boolean> {
    return false
  }
}

export default registerWebModule(ToolBridgeAttentionModule, 'ToolBridgeAttention')
