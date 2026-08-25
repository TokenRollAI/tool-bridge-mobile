import { TBError } from '@tool-bridge/sdk/device'
import * as Crypto from 'expo-crypto'

import { SdkCameraObjectUploader } from '../objectUploader'

const STORE_URI = 'store://default/AbCdEfGhIjKlMnOpQrStUv' as const
const SHA256 = 'd'.repeat(64)

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    checksum: { algorithm: 'sha256' as const, value: SHA256 },
    contentType: 'image/jpeg',
    createdAt: '2026-08-26T01:00:00.000Z',
    readyAt: '2026-08-26T01:00:01.000Z',
    size: 4,
    uri: STORE_URI,
    ...overrides,
  }
}

function uploadInput(uploadObject: jest.Mock) {
  return {
    body: new Blob(['jpeg']),
    bytes: 4,
    commandId: 'command/unsafe-path',
    sha256: SHA256,
    signal: new AbortController().signal,
    uploadObject,
  }
}

describe('SdkCameraObjectUploader', () => {
  test('使用 call-scoped Store capability、checksum 和幂等键上传', async () => {
    const uploadObject = jest.fn(async () => descriptor())
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValueOnce('a'.repeat(64))

    await expect(new SdkCameraObjectUploader().upload(uploadInput(uploadObject)))
      .resolves.toEqual({ objectRef: STORE_URI })
    expect(uploadObject).toHaveBeenCalledWith({
      body: expect.any(Blob),
      checksum: { algorithm: 'sha256', value: SHA256 },
      contentType: 'image/jpeg',
      filename: `${'a'.repeat(64)}.jpg`,
      idempotencyKey: `camera-${'a'.repeat(64)}`,
      size: 4,
    })
  })

  test.each([
    ['错误 URI', { uri: 'node://camera/photos/shot.jpg' }],
    ['错误 MIME', { contentType: 'image/png' }],
    ['错误大小', { size: 5 }],
    ['错误 checksum', { checksum: { algorithm: 'sha256', value: 'e'.repeat(64) } }],
  ])('拒绝 gateway 返回的%s描述', async (_label, override) => {
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValueOnce('b'.repeat(64))
    const uploadObject = jest.fn(async () => descriptor(override))

    await expect(new SdkCameraObjectUploader().upload(uploadInput(uploadObject)))
      .rejects.toMatchObject({ code: 'camera_upload_invalid' })
  })

  test('把 SDK 权限与 call capability 缺失映射为稳定本地错误', async () => {
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValue('c'.repeat(64))
    const createUploader = (error: TBError) => new SdkCameraObjectUploader().upload(uploadInput(
      jest.fn(async () => { throw error }),
    ))

    await expect(createUploader(new TBError('permission_denied', 'secret')))
      .rejects.toMatchObject({ code: 'permission_denied' })
    await expect(createUploader(new TBError('unavailable', 'secret', { retryable: false })))
      .rejects.toMatchObject({ code: 'camera_upload_unavailable', retryable: false })
  })
})
