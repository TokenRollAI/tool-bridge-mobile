export type ToolBridgeSystemShellResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
}>

export type ToolBridgeSystemNativeModule = Readonly<{
  execShellAsync(command: string, timeoutMs: number, maxOutputBytes: number): Promise<ToolBridgeSystemShellResult>
  getClipboardAsync(): Promise<string>
  setClipboardAsync(text: string): Promise<void>
  probeAccessibilityAsync(): Promise<boolean>
  openAccessibilitySettingsAsync(): Promise<void>
  startBackgroundRuntimeAsync(): Promise<void>
  stopBackgroundRuntimeAsync(): Promise<void>
}>
