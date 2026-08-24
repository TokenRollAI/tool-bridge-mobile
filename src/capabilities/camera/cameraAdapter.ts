import { Camera } from 'expo-camera'
import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { throwIfSignalAborted } from '@/capabilities/abortSignal'
import { ToolExecutionError } from '@/capabilities/types'

import ToolBridgeAttentionModule from '../../../modules/tool-bridge-attention/src/ToolBridgeAttentionModule'

import {
  CAMERA_MAX_RAW_BYTES,
  CAMERA_MAX_RESULT_BYTES,
  type CameraCaptureArguments,
} from './schema'

import type { CapturedCameraPhoto } from './captureCoordinator'
import type {
  ToolBridgeAttentionNativeModule,
  ToolBridgeCameraFacing,
} from '../../../modules/tool-bridge-attention/src/ToolBridgeAttention.types'

export type CameraPermission = Readonly<{
  canAskAgain: boolean
  status: 'denied' | 'granted' | 'undetermined'
}>

export interface CameraPlatformAdapter {
  getAvailableFacings(): Promise<readonly ToolBridgeCameraFacing[]>
  getPermission(): Promise<CameraPermission>
  requestPermission(): Promise<CameraPermission>
}

export type ProcessedCameraPhoto = Readonly<{
  body: Blob
  bytes: number
  cleanup(): void
  height: number
  sha256: string
  width: number
}>

export interface CameraPhotoProcessor {
  process(
    photo: CapturedCameraPhoto,
    quality: CameraCaptureArguments['quality'],
    signal: AbortSignal,
  ): Promise<ProcessedCameraPhoto>
}

function mapPermission(permission: Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>): CameraPermission {
  const status = permission.status === 'granted'
    ? 'granted'
    : permission.status === 'denied'
      ? 'denied'
      : 'undetermined'
  return { canAskAgain: permission.canAskAgain, status }
}

export class ExpoCameraPlatformAdapter implements CameraPlatformAdapter {
  constructor(
    private readonly nativeModule: Pick<
      ToolBridgeAttentionNativeModule,
      'getAvailableCameraFacingsAsync'
    > = ToolBridgeAttentionModule,
  ) {}

  async getAvailableFacings(): Promise<readonly ToolBridgeCameraFacing[]> {
    try {
      const facings = await this.nativeModule.getAvailableCameraFacingsAsync()
      if (facings.some(facing => facing !== 'back' && facing !== 'front')) {
        throw new Error('invalid_camera_facing')
      }
      return [...new Set(facings)]
    } catch {
      throw new ToolExecutionError('camera_probe_failed', '系统相机硬件探测失败', true)
    }
  }

  async getPermission(): Promise<CameraPermission> {
    try {
      return mapPermission(await Camera.getCameraPermissionsAsync())
    } catch {
      throw new ToolExecutionError('camera_probe_failed', '系统相机权限探测失败', true)
    }
  }

  async requestPermission(): Promise<CameraPermission> {
    try {
      return mapPermission(await Camera.requestCameraPermissionsAsync())
    } catch {
      throw new ToolExecutionError('camera_permission_failed', '系统相机权限请求失败', false)
    }
  }
}

const PHOTO_PROFILES: Readonly<Record<CameraCaptureArguments['quality'], Readonly<{
  compress: number
  maxEdge: number
}>>> = {
  high: { compress: 0.9, maxEdge: 2_560 },
  low: { compress: 0.55, maxEdge: 1_280 },
  medium: { compress: 0.75, maxEdge: 1_920 },
}

export class ExpoCameraPhotoProcessor implements CameraPhotoProcessor {
  async process(
    photo: CapturedCameraPhoto,
    quality: CameraCaptureArguments['quality'],
    signal: AbortSignal,
  ): Promise<ProcessedCameraPhoto> {
    throwIfSignalAborted(signal)
    const rawFile = new File(photo.uri)
    const rawSize = rawFile.size
    if (!rawFile.exists || rawSize === null || rawSize <= 0) {
      safeDelete(rawFile)
      throw new ToolExecutionError('camera_capture_failed', '系统未生成有效的照片文件', true)
    }
    if (rawSize > CAMERA_MAX_RAW_BYTES) {
      safeDelete(rawFile)
      throw new ToolExecutionError('photo_too_large', '相机原始照片超过本地处理上限', false)
    }

    let processedFile: File | null = null
    try {
      const profile = PHOTO_PROFILES[quality]
      const manipulator = ImageManipulator.manipulate(photo.uri)
      const largestEdge = Math.max(photo.width, photo.height)
      if (largestEdge > profile.maxEdge) {
        if (photo.width >= photo.height) {
          manipulator.resize({ height: null, width: profile.maxEdge })
        } else {
          manipulator.resize({ height: profile.maxEdge, width: null })
        }
      }
      const rendered = await manipulator.renderAsync()
      throwIfSignalAborted(signal)
      const saved = await rendered.saveAsync({
        compress: profile.compress,
        format: SaveFormat.JPEG,
      })
      throwIfSignalAborted(signal)

      processedFile = new File(saved.uri)
      const processedSize = processedFile.size
      if (!processedFile.exists || processedSize === null || processedSize <= 0) {
        throw new ToolExecutionError('camera_processing_failed', '照片重编码没有生成有效文件', true)
      }
      if (processedSize > CAMERA_MAX_RESULT_BYTES) {
        throw new ToolExecutionError('photo_too_large', '处理后的照片仍超过 10 MiB 上限', false)
      }

      const bytes = await processedFile.bytes()
      throwIfSignalAborted(signal)
      if (!isJpeg(bytes)) {
        throw new ToolExecutionError('camera_processing_failed', '处理后的照片不是有效 JPEG', false)
      }
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
      throwIfSignalAborted(signal)
      const sha256 = toHex(digest)
      const outputFile = processedFile
      return {
        body: outputFile,
        bytes: processedSize,
        cleanup: () => {
          safeDelete(rawFile)
          safeDelete(outputFile)
        },
        height: saved.height,
        sha256,
        width: saved.width,
      }
    } catch (error) {
      safeDelete(rawFile)
      if (processedFile !== null) safeDelete(processedFile)
      if (error instanceof ToolExecutionError) throw error
      throw new ToolExecutionError('camera_processing_failed', '照片处理失败', true)
    }
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9
}

function safeDelete(file: File): void {
  try {
    if (file.exists) file.delete()
  } catch {
    // 临时文件清理是 best effort；调用方不会获得其 URI。
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
