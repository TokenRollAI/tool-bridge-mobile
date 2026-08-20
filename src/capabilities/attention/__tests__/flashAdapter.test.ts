import { NativeAttentionFlashAdapter } from '../flashAdapter'

import type { ToolBridgeAttentionNativeModule } from '../../../../modules/tool-bridge-attention/src/ToolBridgeAttention.types'

jest.mock('../../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule', () => ({
  __esModule: true,
  default: {
    cancelAsync: async () => undefined,
    disableTorchAsync: async () => undefined,
    enableTorchAsync: async () => true,
    probeHapticsAsync: async () => true,
    probeTorchAsync: async () => true,
    pulseAsync: async () => true,
  },
}))

function createNativeModule(
  overrides: Partial<ToolBridgeAttentionNativeModule> = {},
): ToolBridgeAttentionNativeModule {
  return {
    cancelAsync: async () => undefined,
    disableTorchAsync: async () => undefined,
    enableTorchAsync: async () => true,
    probeHapticsAsync: async () => true,
    probeTorchAsync: async () => true,
    pulseAsync: async () => true,
    ...overrides,
  }
}

describe('NativeAttentionFlashAdapter', () => {
  test('透传探测/点亮/关闭结果但不暴露 native module 实现', async () => {
    const adapter = new NativeAttentionFlashAdapter(createNativeModule())

    await expect(adapter.probe()).resolves.toBe(true)
    await expect(adapter.enable()).resolves.toBe(true)
    await expect(adapter.disable()).resolves.toBeUndefined()
  })

  test('torch 被占用（enable 抛错）时视为本次通道不可用，而非硬失败', async () => {
    const adapter = new NativeAttentionFlashAdapter(createNativeModule({
      enableTorchAsync: async () => { throw new Error('torch busy detail') },
    }))

    await expect(adapter.enable()).resolves.toBe(false)
  })

  test('probe 与 disable 的 native 异常稳定映射为 native_failure', async () => {
    const probeFailure = new NativeAttentionFlashAdapter(createNativeModule({
      probeTorchAsync: async () => { throw new Error('private probe detail') },
    }))
    await expect(probeFailure.probe()).rejects.toMatchObject({
      code: 'native_failure',
      retryable: false,
    })
    await expect(probeFailure.probe()).rejects.not.toThrow('private')

    const disableFailure = new NativeAttentionFlashAdapter(createNativeModule({
      disableTorchAsync: async () => { throw new Error('private disable detail') },
    }))
    await expect(disableFailure.disable()).rejects.toMatchObject({
      code: 'native_failure',
      retryable: false,
    })
    await expect(disableFailure.disable()).rejects.not.toThrow('private')
  })
})
