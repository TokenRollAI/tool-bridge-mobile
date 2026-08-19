export type ToolBridgeAttentionNativeModule = Readonly<{
  cancelAsync(): Promise<void>
  probeHapticsAsync(): Promise<boolean>
  pulseAsync(): Promise<boolean>
}>
