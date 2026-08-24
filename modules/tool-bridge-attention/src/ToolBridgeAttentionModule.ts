import { NativeModule, requireNativeModule } from 'expo'

import type { ToolBridgeCameraFacing } from './ToolBridgeAttention.types'

declare class ToolBridgeAttentionModule extends NativeModule {
  cancelAsync(): Promise<void>
  disableTorchAsync(): Promise<void>
  enableTorchAsync(): Promise<boolean>
  getAvailableCameraFacingsAsync(): Promise<readonly ToolBridgeCameraFacing[]>
  probeHapticsAsync(): Promise<boolean>
  probeTorchAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}

export default requireNativeModule<ToolBridgeAttentionModule>('ToolBridgeAttention')
