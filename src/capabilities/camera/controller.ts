import { ToolExecutionError } from '@/capabilities/types'

import type {
  CameraPermission,
  CameraPhotoProcessor,
  CameraPlatformAdapter,
} from './cameraAdapter'
import type { CameraCaptureCoordinator } from './captureCoordinator'
import type {
  CameraCaptureArguments,
  CameraCaptureResult,
} from './schema'
import type {
  CapabilityAvailability,
  CapabilityContext,
  CapabilityInvocation,
  CapabilityObjectUploader,
} from '@/capabilities/types'

export interface CameraObjectUploader {
  upload(input: Readonly<{
    body: Blob
    bytes: number
    commandId: string
    sha256: string
    signal: AbortSignal
    uploadObject: CapabilityObjectUploader
  }>): Promise<Readonly<{ objectRef: string }>>
}

type ActiveCapture = {
  abortController: AbortController
  foregroundLost: boolean
}

export class CameraCaptureController {
  #active: ActiveCapture | null = null

  constructor(
    readonly coordinator: CameraCaptureCoordinator,
    private readonly platform: CameraPlatformAdapter,
    private readonly processor: CameraPhotoProcessor,
    private readonly uploader: CameraObjectUploader,
  ) {}

  async capture(
    argumentsValue: CameraCaptureArguments,
    context: CapabilityContext,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<CameraCaptureResult> {
    if (context.appState !== 'active') {
      throw new ToolExecutionError('foreground_required', '相机只允许在 App 前台使用', false)
    }
    if (this.#active !== null) {
      throw new ToolExecutionError('camera_busy', '相机正在处理另一条拍摄请求', true)
    }
    if (invocation.uploadObject === undefined) {
      throw new ToolExecutionError(
        'camera_upload_unavailable',
        'gateway 未提供本次相机调用所需的 Store 上传能力',
        false,
      )
    }

    const active: ActiveCapture = {
      abortController: new AbortController(),
      foregroundLost: false,
    }
    this.#active = active
    const forwardAbort = () => { active.abortController.abort() }
    if (signal.aborted) active.abortController.abort()
    else signal.addEventListener('abort', forwardAbort, { once: true })

    let cleanup: (() => void) | null = null
    try {
      const photo = await this.coordinator.request(
        argumentsValue,
        invocation,
        context.controlMode === 'direct_call',
        active.abortController.signal,
      )
      this.#assertMayContinue(active, invocation.expiresAt)
      const processed = await this.processor.process(
        photo,
        argumentsValue.quality,
        active.abortController.signal,
      )
      cleanup = processed.cleanup
      this.#assertMayContinue(active, invocation.expiresAt)
      const uploaded = await this.uploader.upload({
        body: processed.body,
        bytes: processed.bytes,
        commandId: invocation.commandId,
        sha256: processed.sha256,
        signal: active.abortController.signal,
        uploadObject: invocation.uploadObject,
      })
      this.#assertMayContinue(active, invocation.expiresAt)
      return {
        bytes: processed.bytes,
        height: processed.height,
        mimeType: 'image/jpeg',
        objectRef: uploaded.objectRef,
        sha256: processed.sha256,
        width: processed.width,
      }
    } catch (error) {
      if (active.foregroundLost) {
        throw new ToolExecutionError(
          'foreground_required',
          'App 已离开前台，本次拍摄或上传已取消',
          false,
        )
      }
      if (active.abortController.signal.aborted) {
        throw new ToolExecutionError('cancelled', '拍摄请求已取消', false)
      }
      if (error instanceof ToolExecutionError) throw error
      throw new ToolExecutionError('camera_capture_failed', '拍摄流程失败', true)
    } finally {
      cleanup?.()
      signal.removeEventListener('abort', forwardAbort)
      if (this.#active === active) this.#active = null
    }
  }

  cancelForForegroundLoss(): boolean {
    const active = this.#active
    if (active === null) return false
    active.foregroundLost = true
    active.abortController.abort()
    this.coordinator.rejectForForegroundLoss()
    return true
  }

  async probe(appState: string): Promise<CapabilityAvailability> {
    if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
    try {
      if ((await this.platform.getAvailableFacings()).length === 0) {
        return { reason: 'camera_unavailable', status: 'unavailable' }
      }
      return this.#availability(await this.platform.getPermission())
    } catch (error) {
      return {
        reason: error instanceof ToolExecutionError ? error.code : 'camera_probe_failed',
        status: 'unavailable',
      }
    }
  }

  async preflight(
    facing: CameraCaptureArguments['facing'],
    hasUploadCapability: boolean,
  ): Promise<void> {
    if (!hasUploadCapability) {
      throw new ToolExecutionError(
        'camera_upload_unavailable',
        'gateway 未提供本次相机调用所需的 Store 上传能力',
        false,
      )
    }
    const facings = await this.platform.getAvailableFacings()
    if (!facings.includes(facing)) {
      throw new ToolExecutionError(
        'camera_facing_unavailable',
        `设备没有可用的${facing === 'front' ? '前置' : '后置'}摄像头`,
        false,
      )
    }
  }

  requestPermission(): Promise<CameraPermission> {
    return this.platform.requestPermission()
  }

  #assertMayContinue(active: ActiveCapture, expiresAt: string): void {
    if (active.foregroundLost) {
      throw new ToolExecutionError('foreground_required', 'App 已离开前台', false)
    }
    if (active.abortController.signal.aborted) {
      throw new ToolExecutionError('cancelled', '拍摄请求已取消', false)
    }
    if (Date.parse(expiresAt) <= Date.now()) {
      throw new ToolExecutionError('expired', '拍摄请求已过期', false)
    }
  }

  #availability(permission: CameraPermission): CapabilityAvailability {
    if (permission.status === 'granted') return { status: 'available' }
    if (permission.canAskAgain) {
      return {
        permission: 'camera',
        reason: 'camera_permission_required',
        status: 'permission_required',
      }
    }
    return { reason: 'camera_permission_denied', status: 'unavailable' }
  }
}
