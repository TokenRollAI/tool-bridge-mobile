import { NativeModule, registerWebModule } from 'expo'

import type { ToolBridgeSystemShellResult } from './ToolBridgeSystem.types'

class ToolBridgeSystemModule extends NativeModule {
  async execShellAsync(): Promise<ToolBridgeSystemShellResult> {
    return { exitCode: -1, stdout: '', stderr: 'unsupported_platform', truncated: false }
  }

  async getClipboardAsync(): Promise<string> {
    return ''
  }

  async setClipboardAsync(): Promise<void> {}

  async probeAccessibilityAsync(): Promise<boolean> {
    return false
  }

  async openAccessibilitySettingsAsync(): Promise<void> {}

  async startBackgroundRuntimeAsync(): Promise<void> {}

  async stopBackgroundRuntimeAsync(): Promise<void> {}
}

export default registerWebModule(ToolBridgeSystemModule, 'ToolBridgeSystem')
