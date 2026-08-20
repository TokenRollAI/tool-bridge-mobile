import { NativeAttentionHapticsAdapter } from '../hapticsAdapter'

import type { ToolBridgeAttentionNativeModule } from '../../../../modules/tool-bridge-attention/src/ToolBridgeAttention.types'

jest.mock('../../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule', () => ({
  __esModule: true,
  default: {
    cancelAsync: async () => undefined,
    probeHapticsAsync: async () => true,
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

describe('NativeAttentionHapticsAdapter', () => {
  test('透传成功结果但不暴露 native module 实现', async () => {
    const adapter = new NativeAttentionHapticsAdapter(createNativeModule())

    await expect(adapter.probe()).resolves.toBe(true)
    await expect(adapter.pulse()).resolves.toBe(true)
    await expect(adapter.cancel()).resolves.toBeUndefined()
  })

  test.each([
    ['probe', { probeHapticsAsync: async () => { throw new Error('private probe detail') } }],
    ['pulse', { pulseAsync: async () => { throw new Error('private pulse detail') } }],
    ['cancel', { cancelAsync: async () => { throw new Error('private cancel detail') } }],
  ] as const)('%s 异常稳定映射为 native_failure', async (operation, overrides) => {
    const adapter = new NativeAttentionHapticsAdapter(createNativeModule(overrides))

    await expect(adapter[operation]()).rejects.toMatchObject({
      code: 'native_failure',
      retryable: false,
    })
    await expect(adapter[operation]()).rejects.not.toThrow('private')
  })
})
