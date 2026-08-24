import { TBError } from '@tool-bridge/sdk/device'
import * as Crypto from 'expo-crypto'

import { SdkCameraObjectUploader } from '../objectUploader'

describe('SdkCameraObjectUploader', () => {
  test('使用固定 camera/photos context、设备隔离路径和禁止覆盖的 transport API', async () => {
    const uploadContextObject = jest.fn(async () => ({
      uri: `node://camera/photos/phone_01/${'a'.repeat(64)}.jpg`,
    }))
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValueOnce('a'.repeat(64))
    const uploader = new SdkCameraObjectUploader({
      getSnapshot: () => transportSnapshot('phone_01'),
      uploadContextObject,
    })
    const signal = new AbortController().signal
    await expect(uploader.upload({
      body: new Blob(['jpeg']),
      commandId: 'command/unsafe-path',
      signal,
    })).resolves.toEqual({
      objectRef: `node://camera/photos/phone_01/${'a'.repeat(64)}.jpg`,
    })
    expect(uploadContextObject).toHaveBeenCalledWith({
      body: expect.any(Blob),
      contentType: 'image/jpeg',
      contextPath: 'camera/photos',
      entryPath: `phone_01/${'a'.repeat(64)}.jpg`,
      signal,
    })
  })

  test('拒绝 gateway 返回的跨 context 或同 context 错误路径引用', async () => {
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValueOnce('b'.repeat(64))
    const uploader = new SdkCameraObjectUploader({
      getSnapshot: () => transportSnapshot('phone_01'),
      uploadContextObject: jest.fn(async () => ({ uri: 'node://other/photos/shot.jpg' })),
    })
    await expect(uploader.upload({
      body: new Blob(['jpeg']),
      commandId: 'command_01',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'camera_upload_invalid' })

    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValueOnce('b'.repeat(64))
    const wrongEntryUploader = new SdkCameraObjectUploader({
      getSnapshot: () => transportSnapshot('phone_01'),
      uploadContextObject: jest.fn(async () => ({ uri: 'node://camera/photos/phone_02/shot.jpg' })),
    })
    await expect(wrongEntryUploader.upload({
      body: new Blob(['jpeg']),
      commandId: 'command_02',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'camera_upload_invalid' })
  })

  test('把 SDK 权限与 context 缺失错误映射为稳定本地错误', async () => {
    jest.spyOn(Crypto, 'digestStringAsync').mockResolvedValue('c'.repeat(64))
    const createUploader = (error: TBError) => new SdkCameraObjectUploader({
      getSnapshot: () => transportSnapshot('phone_01'),
      uploadContextObject: jest.fn(async () => { throw error }),
    })
    await expect(createUploader(new TBError('permission_denied', 'secret')).upload({
      body: new Blob(['jpeg']),
      commandId: 'command_01',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(createUploader(new TBError('not_found', 'secret')).upload({
      body: new Blob(['jpeg']),
      commandId: 'command_02',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'camera_upload_unavailable' })
  })
})

function transportSnapshot(deviceId: string) {
  return {
    diagnostic: null,
    deviceId,
    gatewayOrigin: 'https://gateway.example.com',
    issue: null,
    mountPath: `device/phone/${deviceId}`,
    state: 'ready' as const,
  }
}
