import { throwIfSignalAborted } from '@/capabilities/abortSignal'
import { ToolExecutionError } from '@/capabilities/types'

import type {
  CurrentLocationAdapter,
  CurrentLocationFix,
  ForegroundLocationPermission,
} from './locationAdapter'
import type { CurrentLocationArguments } from './schema'
import type { CapabilityAvailability, RuntimeAppState } from '@/capabilities/types'

const MAX_FIX_AGE_MS = 30_000
const MAX_FUTURE_SKEW_MS = 5_000

export type CurrentLocationResult = Readonly<{
  capturedAt: string
  coordinate: Readonly<{
    latitude: number
    longitude: number
  }>
  horizontalAccuracyMeters: number | null
  mocked: boolean | null
  permissionAccuracy: ForegroundLocationPermission['accuracy']
}>

export class CurrentLocationController {
  constructor(
    private readonly adapter: CurrentLocationAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async probe(appState: RuntimeAppState): Promise<CapabilityAvailability> {
    if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
    if (!await this.adapter.servicesEnabled()) {
      return { reason: 'location_services_disabled', status: 'unavailable' }
    }
    const permission = await this.adapter.getPermission()
    if (permission.status === 'granted') return { status: 'available' }
    if (permission.canAskAgain) {
      return {
        permission: 'location_when_in_use',
        reason: 'foreground_location_permission_required',
        status: 'permission_required',
      }
    }
    return { reason: 'location_permission_denied', status: 'unavailable' }
  }

  async current(
    argumentsValue: CurrentLocationArguments,
    signal: AbortSignal,
    commandExpiresAt?: string,
  ): Promise<CurrentLocationResult> {
    this.#assertMayContinue(signal, commandExpiresAt)
    let permission = await this.adapter.getPermission()
    this.#assertMayContinue(signal, commandExpiresAt)
    if (permission.status !== 'granted') {
      if (!permission.canAskAgain) {
        throw new ToolExecutionError('permission_denied', '位置权限已拒绝，请在系统设置中更改', false)
      }
      permission = await this.adapter.requestPermission()
      this.#assertMayContinue(signal, commandExpiresAt)
    }
    if (permission.status !== 'granted') {
      throw new ToolExecutionError('permission_denied', '用户未授予前台位置权限', false)
    }
    if (!await this.adapter.servicesEnabled()) {
      throw new ToolExecutionError('unavailable', '系统位置服务已关闭', false)
    }
    this.#assertMayContinue(signal, commandExpiresAt)
    const argumentTimeoutMs = argumentsValue.timeoutSeconds * 1_000
    const remainingDeadlineMs = commandExpiresAt === undefined
      ? argumentTimeoutMs
      : Date.parse(commandExpiresAt) - this.clock().getTime()
    if (remainingDeadlineMs <= 0) this.#throwExpired()
    const deadlineLimited = remainingDeadlineMs < argumentTimeoutMs
    let fix: CurrentLocationFix
    try {
      fix = await this.adapter.current(
        argumentsValue.accuracy,
        signal,
        Math.min(argumentTimeoutMs, remainingDeadlineMs),
      )
    } catch (error) {
      if (
        deadlineLimited
        && error instanceof ToolExecutionError
        && error.code === 'timeout'
      ) this.#throwExpired()
      throw error
    }
    this.#assertMayContinue(signal, commandExpiresAt)
    const nowMs = this.clock().getTime()
    const ageMs = nowMs - fix.timestampMs
    if (ageMs > MAX_FIX_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS) {
      throw new ToolExecutionError('stale_location', '系统返回的位置时间不可信或已经过期', true)
    }
    return {
      capturedAt: new Date(fix.timestampMs).toISOString(),
      coordinate: { latitude: fix.latitude, longitude: fix.longitude },
      horizontalAccuracyMeters: fix.accuracyMeters,
      mocked: fix.mocked,
      permissionAccuracy: permission.accuracy,
    }
  }

  #assertMayContinue(signal: AbortSignal, commandExpiresAt: string | undefined): void {
    throwIfSignalAborted(signal)
    if (
      commandExpiresAt !== undefined
      && Date.parse(commandExpiresAt) <= this.clock().getTime()
    ) this.#throwExpired()
  }

  #throwExpired(): never {
    throw new ToolExecutionError('expired', '位置命令已过期，未继续采集', false)
  }
}
