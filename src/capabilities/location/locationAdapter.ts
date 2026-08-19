import * as Location from 'expo-location'

import { ToolExecutionError } from '@/capabilities/types'

import type { CurrentLocationArguments } from './schema'

export type ForegroundLocationPermission = Readonly<{
  accuracy: 'precise' | 'approximate' | 'unknown'
  canAskAgain: boolean
  status: 'granted' | 'denied' | 'undetermined'
}>

export type CurrentLocationFix = Readonly<{
  accuracyMeters: number | null
  latitude: number
  longitude: number
  mocked: boolean | null
  timestampMs: number
}>

export interface CurrentLocationAdapter {
  current(
    accuracy: CurrentLocationArguments['accuracy'],
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<CurrentLocationFix>
  getPermission(): Promise<ForegroundLocationPermission>
  requestPermission(): Promise<ForegroundLocationPermission>
  servicesEnabled(): Promise<boolean>
}

function mapPermission(
  permission: Location.LocationPermissionResponse,
): ForegroundLocationPermission {
  let accuracy: ForegroundLocationPermission['accuracy'] = 'unknown'
  if (permission.ios?.accuracy === 'full' || permission.android?.accuracy === 'fine') {
    accuracy = 'precise'
  } else if (permission.ios?.accuracy === 'reduced' || permission.android?.accuracy === 'coarse') {
    accuracy = 'approximate'
  }
  const status = permission.status === 'granted'
    ? 'granted'
    : permission.status === 'denied'
      ? 'denied'
      : 'undetermined'
  return { accuracy, canAskAgain: permission.canAskAgain, status }
}

export class ExpoCurrentLocationAdapter implements CurrentLocationAdapter {
  async current(
    accuracy: CurrentLocationArguments['accuracy'],
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<CurrentLocationFix> {
    if (signal.aborted) throw new ToolExecutionError('cancelled', '位置请求已取消', false)
    return new Promise<CurrentLocationFix>((resolve, reject) => {
      let settled = false
      let subscription: Location.LocationSubscription | null = null
      const finish = (result: CurrentLocationFix | ToolExecutionError) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        subscription?.remove()
        if (result instanceof ToolExecutionError) reject(result)
        else resolve(result)
      }
      const onAbort = () => finish(new ToolExecutionError('cancelled', '位置请求已取消', false))
      const timeout = setTimeout(() => {
        finish(new ToolExecutionError('timeout', '在限定时间内未取得当前位置', true))
      }, timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })

      void Location.watchPositionAsync({
        accuracy: accuracy === 'high' ? Location.Accuracy.High : Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: false,
      }, location => {
        finish({
          accuracyMeters: location.coords.accuracy,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          mocked: location.mocked ?? null,
          timestampMs: location.timestamp,
        })
      }, () => {
        finish(new ToolExecutionError('native_failure', '系统位置采集失败', false))
      }).then(createdSubscription => {
        subscription = createdSubscription
        if (settled) createdSubscription.remove()
      }).catch(() => {
        finish(new ToolExecutionError('native_failure', '系统位置模块启动失败', false))
      })
    })
  }

  async getPermission(): Promise<ForegroundLocationPermission> {
    try {
      return mapPermission(await Location.getForegroundPermissionsAsync())
    } catch {
      throw new ToolExecutionError('native_failure', '位置权限探测失败', false)
    }
  }

  async requestPermission(): Promise<ForegroundLocationPermission> {
    try {
      return mapPermission(await Location.requestForegroundPermissionsAsync())
    } catch {
      throw new ToolExecutionError('native_failure', '位置权限请求失败', false)
    }
  }

  async servicesEnabled(): Promise<boolean> {
    try {
      return await Location.hasServicesEnabledAsync()
    } catch {
      throw new ToolExecutionError('native_failure', '位置服务状态探测失败', false)
    }
  }
}
