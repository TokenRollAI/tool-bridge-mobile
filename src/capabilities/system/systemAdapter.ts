import * as Linking from 'expo-linking'

import { ToolExecutionError } from '@/capabilities/types'

import ToolBridgeSystemModule from '../../../modules/tool-bridge-system/src/ToolBridgeSystemModule'

import type { ToolBridgeSystemNativeModule } from '../../../modules/tool-bridge-system/src/ToolBridgeSystem.types'

export type ShellOutput = Readonly<{
  exitCode: number
  stderr: string
  stdout: string
  truncated: boolean
}>

// 高特权本地能力的原生边界。任何原生失败都归一化为稳定的 ToolExecutionError，
// 不向 Agent 泄漏原生 stack。
export interface SystemAdapter {
  execShell(command: string, timeoutMs: number, maxOutputBytes: number): Promise<ShellOutput>
  getClipboard(): Promise<string>
  setClipboard(text: string): Promise<void>
  probeAccessibility(): Promise<boolean>
  openUrl(url: string): Promise<void>
  startBackgroundRuntime(): Promise<void>
  stopBackgroundRuntime(): Promise<void>
}

export class NativeSystemAdapter implements SystemAdapter {
  constructor(
    private readonly nativeModule: ToolBridgeSystemNativeModule = ToolBridgeSystemModule,
  ) {}

  async execShell(command: string, timeoutMs: number, maxOutputBytes: number): Promise<ShellOutput> {
    try {
      return await this.nativeModule.execShellAsync(command, timeoutMs, maxOutputBytes)
    } catch (error) {
      if (error instanceof Error && error.message.includes('shell_timeout')) {
        throw new ToolExecutionError('timeout', 'shell 命令在本地时限内未结束', false)
      }
      throw new ToolExecutionError('native_failure', 'shell 命令执行失败', false)
    }
  }

  async getClipboard(): Promise<string> {
    try {
      return await this.nativeModule.getClipboardAsync()
    } catch {
      throw new ToolExecutionError('native_failure', '读取系统剪贴板失败', false)
    }
  }

  async setClipboard(text: string): Promise<void> {
    try {
      await this.nativeModule.setClipboardAsync(text)
    } catch {
      throw new ToolExecutionError('native_failure', '写入系统剪贴板失败', false)
    }
  }

  async probeAccessibility(): Promise<boolean> {
    try {
      return await this.nativeModule.probeAccessibilityAsync()
    } catch {
      return false
    }
  }

  async openUrl(url: string): Promise<void> {
    try {
      await Linking.openURL(url)
    } catch {
      throw new ToolExecutionError('unavailable', '系统未接受该 URL/Intent handoff', false)
    }
  }

  async startBackgroundRuntime(): Promise<void> {
    await this.nativeModule.startBackgroundRuntimeAsync()
  }

  async stopBackgroundRuntime(): Promise<void> {
    await this.nativeModule.stopBackgroundRuntimeAsync()
  }
}
