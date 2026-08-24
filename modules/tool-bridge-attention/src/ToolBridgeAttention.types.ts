export type ToolBridgeCameraFacing = 'back' | 'front'

export type ToolBridgeAttentionNativeModule = Readonly<{
  cancelAsync(): Promise<void>
  disableTorchAsync(): Promise<void>
  enableTorchAsync(): Promise<boolean>
  getAvailableCameraFacingsAsync(): Promise<readonly ToolBridgeCameraFacing[]>
  probeHapticsAsync(): Promise<boolean>
  probeTorchAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}>
