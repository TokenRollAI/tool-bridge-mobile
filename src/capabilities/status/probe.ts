import * as Battery from 'expo-battery'
import * as Network from 'expo-network'
import { AppState, Platform } from 'react-native'

import type {
  BatterySummary,
  FieldAvailability,
  NetworkSummary,
  StatusObservation,
} from './schema'

export interface StatusProbe {
  observe(signal: AbortSignal): Promise<StatusObservation>
}

function unavailable<Value>(reason: string): FieldAvailability<Value> {
  return { availability: 'unavailable', reason }
}

async function observeBattery(): Promise<FieldAvailability<BatterySummary>> {
  try {
    const state = await Battery.getPowerStateAsync()
    if (state.batteryLevel < 0) return unavailable('battery_level_unavailable')
    return {
      availability: 'available',
      value: {
        charging: state.batteryState === Battery.BatteryState.CHARGING
          || state.batteryState === Battery.BatteryState.FULL,
        level: state.batteryLevel,
        lowPowerMode: state.lowPowerMode,
      },
    }
  } catch {
    return unavailable('battery_probe_failed')
  }
}

async function observeNetwork(): Promise<FieldAvailability<NetworkSummary>> {
  try {
    const state = await Network.getNetworkStateAsync()
    return {
      availability: 'available',
      value: {
        internetReachable: state.isInternetReachable ?? null,
        type: String(state.type).toLowerCase(),
      },
    }
  } catch {
    return unavailable('network_probe_failed')
  }
}

export class ExpoStatusProbe implements StatusProbe {
  async observe(signal: AbortSignal): Promise<StatusObservation> {
    signal.throwIfAborted()
    const [battery, network] = await Promise.all([observeBattery(), observeNetwork()])
    signal.throwIfAborted()
    return {
      battery,
      network,
      observedAt: new Date().toISOString(),
      platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
    }
  }
}

export function currentRuntimeAppState(): 'active' | 'background' | 'inactive' | 'unknown' {
  const appState = AppState.currentState
  if (appState === 'active' || appState === 'background' || appState === 'inactive') return appState
  return 'unknown'
}
