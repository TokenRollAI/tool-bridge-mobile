import { NativeModule, requireNativeModule } from 'expo'

import type { ToolBridgeSystemShellResult } from './ToolBridgeSystem.types'

declare class ToolBridgeSystemModule extends NativeModule {
  execShellAsync(
    command: string,
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<ToolBridgeSystemShellResult>
  getClipboardAsync(): Promise<string>
  setClipboardAsync(text: string): Promise<void>
  probeAccessibilityAsync(): Promise<boolean>
  openAccessibilitySettingsAsync(): Promise<void>
  startBackgroundRuntimeAsync(): Promise<void>
  stopBackgroundRuntimeAsync(): Promise<void>
}

export default requireNativeModule<ToolBridgeSystemModule>('ToolBridgeSystem')
