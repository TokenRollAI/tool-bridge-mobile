import * as Linking from 'expo-linking'

import { ToolExecutionError } from '@/capabilities/types'

export interface AppLinkingAdapter {
  canOpen(url: string): Promise<boolean>
  open(url: string): Promise<void>
  probe(): boolean
}

export class ExpoAppLinkingAdapter implements AppLinkingAdapter {
  async canOpen(url: string): Promise<boolean> {
    try {
      return await Linking.canOpenURL(url)
    } catch {
      throw new ToolExecutionError('native_failure', '系统 URL 能力检查失败', false)
    }
  }

  async open(url: string): Promise<void> {
    try {
      await Linking.openURL(url)
    } catch {
      throw new ToolExecutionError('native_failure', '系统未接受 URL handoff', false)
    }
  }

  probe(): boolean {
    return typeof Linking.canOpenURL === 'function' && typeof Linking.openURL === 'function'
  }
}
