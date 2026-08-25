import { TBError } from '@tool-bridge/sdk/device'
import * as Crypto from 'expo-crypto'

import { ToolExecutionError } from '@/capabilities/types'

import type { CameraObjectUploader } from './controller'
import type { CapabilityObjectUploader } from '@/capabilities/types'

export class SdkCameraObjectUploader implements CameraObjectUploader {
  async upload(input: Readonly<{
    body: Blob
    bytes: number
    commandId: string
    sha256: string
    signal: AbortSignal
    uploadObject: CapabilityObjectUploader
  }>): Promise<Readonly<{ objectRef: string }>> {
    if (input.signal.aborted) throw cancelledError()
    const commandHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      input.commandId,
    )
    if (input.signal.aborted) throw cancelledError()

    try {
      const uploaded = await input.uploadObject({
        body: input.body,
        checksum: { algorithm: 'sha256', value: input.sha256 },
        contentType: 'image/jpeg',
        filename: `${commandHash}.jpg`,
        idempotencyKey: `camera-${commandHash}`,
        size: input.bytes,
      })
      if (
        !/^store:\/\/default\/[A-Za-z0-9_-]{22,64}$/.test(uploaded.uri)
        || uploaded.contentType !== 'image/jpeg'
        || uploaded.size !== input.bytes
        || (
          uploaded.checksum !== undefined
          && (
            uploaded.checksum.algorithm !== 'sha256'
            || uploaded.checksum.value !== input.sha256
          )
        )
      ) {
        throw new ToolExecutionError(
          'camera_upload_invalid',
          'gateway 返回的 Store 对象描述与本次照片不匹配',
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
            'gateway Store 上传能力不可用',
            false,
          )
        }
        if (error.code === 'unavailable' && !error.retryable) {
          throw new ToolExecutionError(
            'camera_upload_unavailable',
            'gateway 未为本次调用提供可用的 Store 上传能力',
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
