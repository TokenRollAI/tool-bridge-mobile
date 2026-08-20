export type ToolBridgeAttentionNativeModule = Readonly<{
  cancelAsync(): Promise<void>
  disableTorchAsync(): Promise<void>
  enableTorchAsync(): Promise<boolean>
  probeHapticsAsync(): Promise<boolean>
  probeTorchAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}>
