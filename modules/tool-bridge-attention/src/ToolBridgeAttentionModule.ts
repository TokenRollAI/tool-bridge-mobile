import { NativeModule, requireNativeModule } from 'expo'

declare class ToolBridgeAttentionModule extends NativeModule {
  cancelAsync(): Promise<void>
  disableTorchAsync(): Promise<void>
  enableTorchAsync(): Promise<boolean>
  probeHapticsAsync(): Promise<boolean>
  probeTorchAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}

export default requireNativeModule<ToolBridgeAttentionModule>('ToolBridgeAttention')
