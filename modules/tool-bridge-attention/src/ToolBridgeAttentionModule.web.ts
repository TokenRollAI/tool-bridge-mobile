import { NativeModule, registerWebModule } from 'expo'

class ToolBridgeAttentionModule extends NativeModule {
  async cancelAsync(): Promise<void> {}

  async probeHapticsAsync(): Promise<boolean> {
    return false
  }

  async pulseAsync(): Promise<boolean> {
    return false
  }
}

export default registerWebModule(ToolBridgeAttentionModule, 'ToolBridgeAttention')
