import { ToolExecutionError } from '@/capabilities/types'

import { CurrentLocationController } from '../controller'
import { currentLocationArgumentsSchema } from '../schema'

import type {
  CurrentLocationAdapter,
  CurrentLocationFix,
  ForegroundLocationPermission,
} from '../locationAdapter'

class FakeLocationAdapter implements CurrentLocationAdapter {
  currentCalls = 0
  currentError: ToolExecutionError | null = null
  currentTimeouts: number[] = []
  permissionReads = 0
  permission: ForegroundLocationPermission = {
    accuracy: 'unknown',
    canAskAgain: true,
    status: 'undetermined',
  }
  requestedPermission: ForegroundLocationPermission = {
    accuracy: 'approximate',
    canAskAgain: true,
    status: 'granted',
  }
  services = true
  fix: CurrentLocationFix = {
    accuracyMeters: 120,
    latitude: 31.2304,
    longitude: 121.4737,
    mocked: false,
    timestampMs: Date.parse('2026-08-19T00:00:01.000Z'),
  }

  async current(
    _accuracy: 'balanced' | 'high',
    _signal: AbortSignal,
    timeoutMs: number,
  ): Promise<CurrentLocationFix> {
    this.currentCalls += 1
    this.currentTimeouts.push(timeoutMs)
    if (this.currentError !== null) throw this.currentError
    return this.fix
  }

  async getPermission(): Promise<ForegroundLocationPermission> {
    this.permissionReads += 1
    return this.permission
  }

  async requestPermission(): Promise<ForegroundLocationPermission> {
    this.permission = this.requestedPermission
    return this.permission
  }

  async servicesEnabled(): Promise<boolean> {
    return this.services
  }
}

const argumentsValue = currentLocationArgumentsSchema.parse({
  purpose: '查找附近门店',
})

describe('CurrentLocationController', () => {
  test('probe 区分 permission_required、available 与不可再次请求', async () => {
    const adapter = new FakeLocationAdapter()
    const controller = new CurrentLocationController(adapter)
    await expect(controller.probe('active')).resolves.toMatchObject({
      permission: 'location_when_in_use',
      status: 'permission_required',
    })
    adapter.permission = { accuracy: 'precise', canAskAgain: true, status: 'granted' }
    await expect(controller.probe('active')).resolves.toEqual({ status: 'available' })
    adapter.permission = { accuracy: 'unknown', canAskAgain: false, status: 'denied' }
    await expect(controller.probe('active')).resolves.toEqual({
      reason: 'location_permission_denied',
      status: 'unavailable',
    })
    await expect(controller.probe('background')).resolves.toEqual({
      reason: 'foreground_required',
      status: 'unavailable',
    })
  })

  test('确认后按需请求前台权限并返回采集时间、精度和 approximate 状态', async () => {
    const adapter = new FakeLocationAdapter()
    const controller = new CurrentLocationController(
      adapter,
      () => new Date('2026-08-19T00:00:02.000Z'),
    )
    await expect(controller.current(
      argumentsValue,
      new AbortController().signal,
    )).resolves.toEqual({
      capturedAt: '2026-08-19T00:00:01.000Z',
      coordinate: { latitude: 31.2304, longitude: 121.4737 },
      horizontalAccuracyMeters: 120,
      mocked: false,
      permissionAccuracy: 'approximate',
    })
    expect(adapter.currentCalls).toBe(1)
  })

  test('用户拒绝、服务关闭和 stale fix 都不是成功', async () => {
    const deniedAdapter = new FakeLocationAdapter()
    deniedAdapter.requestedPermission = {
      accuracy: 'unknown',
      canAskAgain: false,
      status: 'denied',
    }
    await expect(new CurrentLocationController(deniedAdapter).current(
      argumentsValue,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'permission_denied' })
    expect(deniedAdapter.currentCalls).toBe(0)

    const disabledAdapter = new FakeLocationAdapter()
    disabledAdapter.permission = { accuracy: 'precise', canAskAgain: true, status: 'granted' }
    disabledAdapter.services = false
    await expect(new CurrentLocationController(disabledAdapter).current(
      argumentsValue,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'unavailable' })

    const staleAdapter = new FakeLocationAdapter()
    staleAdapter.permission = { accuracy: 'precise', canAskAgain: true, status: 'granted' }
    staleAdapter.fix = { ...staleAdapter.fix, timestampMs: Date.parse('2026-08-18T23:59:00.000Z') }
    await expect(new CurrentLocationController(
      staleAdapter,
      () => new Date('2026-08-19T00:00:02.000Z'),
    ).current(argumentsValue, new AbortController().signal)).rejects.toMatchObject({
      code: 'stale_location',
    })
  })

  test('取消发生在权限读取前，command deadline 截断采集 timeout', async () => {
    const cancelledAdapter = new FakeLocationAdapter()
    const abortController = new AbortController()
    abortController.abort()
    await expect(new CurrentLocationController(cancelledAdapter).current(
      argumentsValue,
      abortController.signal,
      '2026-08-19T00:00:05.000Z',
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledAdapter.permissionReads).toBe(0)

    const deadlineAdapter = new FakeLocationAdapter()
    deadlineAdapter.permission = { accuracy: 'precise', canAskAgain: true, status: 'granted' }
    deadlineAdapter.currentError = new ToolExecutionError('timeout', 'fixture timeout', true)
    const controller = new CurrentLocationController(
      deadlineAdapter,
      () => new Date('2026-08-19T00:00:00.000Z'),
    )
    await expect(controller.current(
      argumentsValue,
      new AbortController().signal,
      '2026-08-19T00:00:01.000Z',
    )).rejects.toMatchObject({ code: 'expired' })
    expect(deadlineAdapter.currentTimeouts).toEqual([1_000])
  })

  test('schema 对 purpose、精度、timeout 和未知字段设硬边界', () => {
    expect(currentLocationArgumentsSchema.safeParse({ purpose: '' }).success).toBe(false)
    expect(currentLocationArgumentsSchema.safeParse({ purpose: 'x'.repeat(121) }).success).toBe(false)
    expect(currentLocationArgumentsSchema.safeParse({ purpose: 'ok', timeoutSeconds: 31 }).success)
      .toBe(false)
    expect(currentLocationArgumentsSchema.safeParse({ purpose: 'ok', accuracy: 'navigation' }).success)
      .toBe(false)
    expect(currentLocationArgumentsSchema.safeParse({ purpose: 'ok', background: true }).success)
      .toBe(false)
    expect(currentLocationArgumentsSchema.safeParse({ purpose: '门店\u202e系统设置' }).success).toBe(false)
  })
})
