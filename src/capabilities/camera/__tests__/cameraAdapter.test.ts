import { ExpoCameraPlatformAdapter } from '../cameraAdapter'

jest.mock('../../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule', () => ({
  __esModule: true,
  default: {
    getAvailableCameraFacingsAsync: async () => ['back', 'front'],
  },
}))

describe('ExpoCameraPlatformAdapter', () => {
  test('使用原生 front/back 枚举，去重后返回稳定结果', async () => {
    const adapter = new ExpoCameraPlatformAdapter({
      getAvailableCameraFacingsAsync: async () => ['front', 'back', 'front'],
    })

    await expect(adapter.getAvailableFacings()).resolves.toEqual(['front', 'back'])
  })

  test('原生枚举异常与未知 facing 都稳定映射且不泄露原始详情', async () => {
    const nativeFailure = new ExpoCameraPlatformAdapter({
      getAvailableCameraFacingsAsync: async () => { throw new Error('private camera detail') },
    })
    await expect(nativeFailure.getAvailableFacings()).rejects.toMatchObject({
      code: 'camera_probe_failed',
      retryable: true,
    })
    await expect(nativeFailure.getAvailableFacings()).rejects.not.toThrow('private')

    const malformed = new ExpoCameraPlatformAdapter({
      getAvailableCameraFacingsAsync: async () => ['external'] as never,
    })
    await expect(malformed.getAvailableFacings()).rejects.toMatchObject({
      code: 'camera_probe_failed',
    })
  })
})
