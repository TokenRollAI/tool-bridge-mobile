import * as Linking from 'expo-linking'
import { Platform } from 'react-native'

import { ToolExecutionError } from '@/capabilities/types'

import type { MapPlatform } from './mapTargetBuilder'

export interface MapHandoffAdapter {
  canOpen(uri: string): Promise<boolean>
  open(uri: string): Promise<void>
  platform(): MapPlatform | null
  probe(): boolean
}

export class ExpoMapHandoffAdapter implements MapHandoffAdapter {
  canOpen(uri: string): Promise<boolean> {
    return Linking.canOpenURL(uri).catch(() => {
      throw new ToolExecutionError('native_failure', '系统地图能力检查失败', false)
    })
  }

  async open(uri: string): Promise<void> {
    try {
      await Linking.openURL(uri)
    } catch {
      throw new ToolExecutionError('native_failure', '系统未接受地图 handoff', false)
    }
  }

  platform(): MapPlatform | null {
    if (Platform.OS === 'android' || Platform.OS === 'ios') return Platform.OS
    return null
  }

  probe(): boolean {
    return typeof Linking.canOpenURL === 'function' && typeof Linking.openURL === 'function'
  }
}
