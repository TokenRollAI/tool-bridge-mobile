import { NativeModule, requireNativeModule } from 'expo'

declare class ToolBridgeAttentionModule extends NativeModule {
  cancelAsync(): Promise<void>
  probeHapticsAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}

export default requireNativeModule<ToolBridgeAttentionModule>('ToolBridgeAttention')
