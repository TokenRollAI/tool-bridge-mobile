import * as Battery from 'expo-battery'
import * as Network from 'expo-network'

import { createReactNativeAbortSignal } from '@/testFixtures/reactNativeAbortSignal'

import { ExpoStatusProbe } from '../probe'

jest.mock('expo-battery', () => ({
  BatteryState: { CHARGING: 2, FULL: 5 },
  getPowerStateAsync: jest.fn(),
}))

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
}))

describe('ExpoStatusProbe', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(Battery.getPowerStateAsync).mockResolvedValue({
      batteryLevel: 0.31,
      batteryState: Battery.BatteryState.CHARGING,
      lowPowerMode: false,
    })
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
      type: 'CELLULAR' as Network.NetworkStateType,
    })
  })

  test('缺少 throwIfAborted 时仍返回电池和网络状态', async () => {
    const signal = createReactNativeAbortSignal()

    await expect(new ExpoStatusProbe().observe(signal)).resolves.toMatchObject({
      battery: {
        availability: 'available',
        value: { charging: true, level: 0.31, lowPowerMode: false },
      },
      network: {
        availability: 'available',
        value: { internetReachable: true, type: 'cellular' },
      },
    })
    expect('throwIfAborted' in signal).toBe(false)
  })

  test('React Native signal 已取消时不读取原生状态', async () => {
    await expect(new ExpoStatusProbe().observe(
      createReactNativeAbortSignal(true),
    )).rejects.toMatchObject({
      message: 'Aborted',
      name: 'AbortError',
    })
    expect(Battery.getPowerStateAsync).not.toHaveBeenCalled()
    expect(Network.getNetworkStateAsync).not.toHaveBeenCalled()
  })
})
