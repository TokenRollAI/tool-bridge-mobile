import { TBError } from '@tool-bridge/sdk/device'
import * as Crypto from 'expo-crypto'

import { ToolExecutionError } from '@/capabilities/types'

import { CAMERA_UPLOAD_CONTEXT_PATH } from './schema'

import type { CameraObjectUploader } from './controller'
import type { SdkDeviceTransport } from '@/gateway/sdkDeviceTransport'

export class SdkCameraObjectUploader implements CameraObjectUploader {
  constructor(private readonly transport: Pick<
    SdkDeviceTransport,
    'getSnapshot' | 'uploadContextObject'
  >) {}

  async upload(input: Readonly<{
    body: Blob
    commandId: string
    signal: AbortSignal
  }>): Promise<Readonly<{ objectRef: string }>> {
    if (input.signal.aborted) throw cancelledError()
    const deviceId = this.transport.getSnapshot().deviceId
    if (deviceId === null) {
      throw new ToolExecutionError('camera_upload_unavailable', '设备连接身份不可用', true)
    }
    const commandHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      input.commandId,
    )
    if (input.signal.aborted) throw cancelledError()
    const entryPath = `${deviceId}/${commandHash}.jpg`
    const expectedUri = `node://${CAMERA_UPLOAD_CONTEXT_PATH}/${entryPath}`

    try {
      const uploaded = await this.transport.uploadContextObject({
        body: input.body,
        contentType: 'image/jpeg',
        contextPath: CAMERA_UPLOAD_CONTEXT_PATH,
        entryPath,
        signal: input.signal,
      })
      if (uploaded.uri !== expectedUri) {
        throw new ToolExecutionError(
          'camera_upload_invalid',
          'gateway 返回的对象引用与本次相机上传路径不匹配',
          false,
        )
      }
      return { objectRef: uploaded.uri }
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw cancelledError()
      }
      if (error instanceof ToolExecutionError) throw error
      if (error instanceof TBError) {
        if (error.code === 'permission_denied') {
          throw new ToolExecutionError('permission_denied', '设备凭证无权上传相机对象', false)
        }
        if (error.code === 'not_found') {
          throw new ToolExecutionError(
            'camera_upload_unavailable',
            `gateway 未挂载可写 context ${CAMERA_UPLOAD_CONTEXT_PATH}`,
            false,
          )
        }
        if (error.code === 'conflict') {
          throw new ToolExecutionError('camera_upload_conflict', '相机对象路径已存在，拒绝覆盖', false)
        }
        throw new ToolExecutionError(
          'camera_upload_failed',
          '相机对象上传失败',
          error.retryable,
        )
      }
      throw new ToolExecutionError('camera_upload_failed', '相机对象上传失败', true)
    }
  }
}

function cancelledError(): ToolExecutionError {
  return new ToolExecutionError('cancelled', '相机对象上传已取消', false)
}
