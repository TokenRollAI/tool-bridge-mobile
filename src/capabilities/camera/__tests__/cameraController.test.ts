import { createCameraCaptureCapability } from '../cameraCapability'
import { CameraCaptureCoordinator } from '../captureCoordinator'
import { CameraCaptureController } from '../controller'

import type {
  CameraPermission,
  CameraPhotoProcessor,
  CameraPlatformAdapter,
  ProcessedCameraPhoto,
} from '../cameraAdapter'
import type { CameraObjectUploader } from '../controller'
import type { CapabilityContext, CapabilityInvocation } from '@/capabilities/types'

const invocation: CapabilityInvocation = {
  caller: { displayName: '相机 Agent', subjectId: 'caller_01' },
  commandId: 'command_01',
  createdAt: '2026-08-25T08:00:00.000Z',
  expiresAt: '2099-08-25T08:02:00.000Z',
}

const baseContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_01',
  reachability: 'online',
}

function platform(overrides: Partial<CameraPlatformAdapter> = {}): CameraPlatformAdapter {
  return {
    getAvailableFacings: jest.fn(async (): Promise<readonly ('back' | 'front')[]> => (
      ['back', 'front']
    )),
    getPermission: jest.fn(async (): Promise<CameraPermission> => ({
      canAskAgain: true,
      status: 'granted',
    })),
    requestPermission: jest.fn(async (): Promise<CameraPermission> => ({
      canAskAgain: true,
      status: 'granted',
    })),
    ...overrides,
  }
}

function harness() {
  const coordinator = new CameraCaptureCoordinator()
  const cleanup = jest.fn()
  const processed: ProcessedCameraPhoto = {
    body: new Blob(['jpeg']),
    bytes: 4,
    cleanup,
    height: 1080,
    sha256: 'a'.repeat(64),
    width: 1920,
  }
  const processor: CameraPhotoProcessor = {
    process: jest.fn(async () => processed),
  }
  const uploader: CameraObjectUploader = {
    upload: jest.fn(async () => ({ objectRef: 'node://camera/photos/device/shot.jpg' })),
  }
  const controller = new CameraCaptureController(coordinator, platform(), processor, uploader)
  return { cleanup, controller, coordinator, processor, uploader }
}

describe('CameraCaptureController', () => {
  test('direct_call 在前台建立自动拍摄请求并上传有限元数据', async () => {
    const { cleanup, controller, coordinator, processor, uploader } = harness()
    const resultPromise = controller.capture({
      facing: 'back',
      purpose: '查看桌面上的设备',
      quality: 'medium',
    }, { ...baseContext, controlMode: 'direct_call' }, invocation, new AbortController().signal)

    expect(coordinator.getRequest()).toMatchObject({
      automatic: true,
      commandId: 'command_01',
      purpose: '查看桌面上的设备',
    })
    expect(coordinator.submit('command_01', {
      height: 3024,
      uri: 'file:///cache/raw.jpg',
      width: 4032,
    })).toBe(true)

    await expect(resultPromise).resolves.toEqual({
      bytes: 4,
      height: 1080,
      mimeType: 'image/jpeg',
      objectRef: 'node://camera/photos/device/shot.jpg',
      sha256: 'a'.repeat(64),
      width: 1920,
    })
    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/raw.jpg' }),
      'medium',
      expect.any(AbortSignal),
    )
    expect(uploader.upload).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'command_01' }))
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  test('非 direct_call 请求保留用户主动拍摄语义', async () => {
    const { controller, coordinator } = harness()
    const resultPromise = controller.capture({
      facing: 'front',
      purpose: '确认本人在镜头前',
      quality: 'low',
    }, baseContext, invocation, new AbortController().signal)
    expect(coordinator.getRequest()).toMatchObject({ automatic: false, facing: 'front' })
    coordinator.fail('command_01', 'user_cancelled')
    await expect(resultPromise).rejects.toMatchObject({ code: 'user_rejected' })
  })

  test('后台直接拒绝且不会创建预览请求', async () => {
    const { controller, coordinator } = harness()
    await expect(controller.capture({
      facing: 'back',
      purpose: '后台拍摄应拒绝',
      quality: 'high',
    }, { ...baseContext, appState: 'background', controlMode: 'direct_call' }, invocation, new AbortController().signal))
      .rejects.toMatchObject({ code: 'foreground_required' })
    expect(coordinator.getRequest()).toBeNull()
  })

  test('处理中切到后台会取消上传并清理临时文件', async () => {
    const coordinator = new CameraCaptureCoordinator()
    const cleanup = jest.fn()
    let releaseProcessing: ((value: ProcessedCameraPhoto) => void) | undefined
    const processor: CameraPhotoProcessor = {
      process: jest.fn(() => new Promise(resolve => { releaseProcessing = resolve })),
    }
    const uploader: CameraObjectUploader = { upload: jest.fn() }
    const controller = new CameraCaptureController(coordinator, platform(), processor, uploader)
    const resultPromise = controller.capture({
      facing: 'back',
      purpose: '测试前后台边界',
      quality: 'medium',
    }, { ...baseContext, controlMode: 'direct_call' }, invocation, new AbortController().signal)
    coordinator.submit('command_01', { height: 10, uri: 'file:///raw.jpg', width: 10 })
    await Promise.resolve()
    expect(controller.cancelForForegroundLoss()).toBe(true)
    releaseProcessing?.({
      body: new Blob(['jpeg']),
      bytes: 4,
      cleanup,
      height: 10,
      sha256: 'b'.repeat(64),
      width: 10,
    })
    await expect(resultPromise).rejects.toMatchObject({ code: 'foreground_required' })
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(uploader.upload).not.toHaveBeenCalled()
  })

  test('probe 区分可请求权限、永久拒绝和硬件不可用', async () => {
    const coordinator = new CameraCaptureCoordinator()
    const unusedProcessor = {} as CameraPhotoProcessor
    const unusedUploader = {} as CameraObjectUploader
    const requestable = new CameraCaptureController(coordinator, platform({
      getPermission: jest.fn(async (): Promise<CameraPermission> => ({
        canAskAgain: true,
        status: 'undetermined',
      })),
    }), unusedProcessor, unusedUploader)
    await expect(requestable.probe('active')).resolves.toEqual({
      permission: 'camera',
      reason: 'camera_permission_required',
      status: 'permission_required',
    })

    const denied = new CameraCaptureController(new CameraCaptureCoordinator(), platform({
      getPermission: jest.fn(async (): Promise<CameraPermission> => ({
        canAskAgain: false,
        status: 'denied',
      })),
    }), unusedProcessor, unusedUploader)
    await expect(denied.probe('active')).resolves.toEqual({
      reason: 'camera_permission_denied',
      status: 'unavailable',
    })

    const unavailable = new CameraCaptureController(new CameraCaptureCoordinator(), platform({
      getAvailableFacings: jest.fn(async () => []),
    }), unusedProcessor, unusedUploader)
    await expect(unavailable.probe('active')).resolves.toEqual({
      reason: 'camera_unavailable',
      status: 'unavailable',
    })
  })

  test('preflight 在确认前拒绝设备不存在的镜头朝向', async () => {
    const controller = new CameraCaptureController(
      new CameraCaptureCoordinator(),
      platform({
        getAvailableFacings: jest.fn(async (): Promise<readonly ('back' | 'front')[]> => ['back']),
      }),
      {} as CameraPhotoProcessor,
      {} as CameraObjectUploader,
    )

    await expect(controller.preflight('front')).rejects.toMatchObject({
      code: 'camera_facing_unavailable',
      retryable: false,
    })
    await expect(controller.preflight('back')).resolves.toBeUndefined()
  })

  test('capability 使用 high/write/always 并有 strict 默认参数', () => {
    const { controller } = harness()
    const capability = createCameraCaptureCapability(controller)
    expect(capability.descriptor).toMatchObject({
      confirmation: 'always',
      effect: 'write',
      path: 'phone/camera',
      risk: 'high',
      tool: 'capture_photo',
    })
    expect(capability.inputSchema.parse({ purpose: '检查设备' })).toEqual({
      facing: 'back',
      purpose: '检查设备',
      quality: 'medium',
    })
    expect(() => capability.inputSchema.parse({ purpose: '检查', url: 'https://example.com' })).toThrow()
  })
})
