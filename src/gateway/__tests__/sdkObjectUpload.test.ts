import { fetch as expoFetch } from 'expo/fetch'

import { CapabilityRegistry } from '@/capabilities/registry'
import { SdkDeviceTransport } from '@/gateway/sdkDeviceTransport'

import type {
  DeviceCredentialEnvelope,
  DeviceCredentialStore,
} from '@/identity/deviceCredentialStore'

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }))

const mockedFetch = expoFetch as jest.MockedFunction<typeof expoFetch>

const credential: DeviceCredentialEnvelope = {
  audienceOrigin: 'https://gateway.example.com',
  deviceId: 'phone_01',
  keyId: 'device_key_01',
  material: 'opaque-secret',
  version: 1,
}

class MemoryCredentialStore implements DeviceCredentialStore {
  constructor(public value: DeviceCredentialEnvelope | null) {}
  async clear() { this.value = null }
  async get() { return this.value }
  async save(value: DeviceCredentialEnvelope) { this.value = value }
}

describe('SdkDeviceTransport object upload', () => {
  beforeEach(() => { mockedFetch.mockReset() })

  test('使用 HTTP Authorization 申请 grant，再原样 PUT Blob 且只返回稳定 node URI', async () => {
    mockedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        expiresAt: '2099-08-25T08:05:00.000Z',
        headers: { 'content-type': 'image/jpeg', 'x-upload-token': 'signed' },
        method: 'PUT',
        uri: 'node://camera/photos/phone_01/shot.jpg',
        url: 'https://objects.example.com/signed-upload?secret=hidden',
      }), { status: 200 }) as unknown as Awaited<ReturnType<typeof expoFetch>>)
      .mockResolvedValueOnce(new Response(null, {
        headers: { etag: 'etag-01' },
        status: 200,
      }) as unknown as Awaited<ReturnType<typeof expoFetch>>)
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async () => ({ ok: true, value: null }),
      registry: new CapabilityRegistry(),
      webSocketFactory: { open: () => { throw new Error('unexpected WebSocket') } },
    })
    const body = new Blob(['jpeg'], { type: 'image/jpeg' })
    await expect(transport.uploadContextObject({
      body,
      contentType: 'image/jpeg',
      contextPath: 'camera/photos',
      entryPath: 'phone_01/shot.jpg',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      etag: 'etag-01',
      uri: 'node://camera/photos/phone_01/shot.jpg',
    })

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    const [grantUrl, grantInit] = mockedFetch.mock.calls[0] ?? []
    expect(String(grantUrl)).toBe('https://gateway.example.com/camera/photos/create_upload')
    expect(new Headers(grantInit?.headers).get('authorization')).toBe('Bearer opaque-secret')
    expect(JSON.parse(String(grantInit?.body))).toEqual({
      contentType: 'image/jpeg',
      path: 'phone_01/shot.jpg',
    })
    const [uploadUrl, uploadInit] = mockedFetch.mock.calls[1] ?? []
    expect(String(uploadUrl)).toContain('objects.example.com/signed-upload')
    expect(uploadInit?.body).toBe(body)
    expect(new Headers(uploadInit?.headers).get('x-upload-token')).toBe('signed')
  })

  test('create-upload 拒绝只清除本次使用的精确 credential，不误删已轮换值', async () => {
    const exactStore = new MemoryCredentialStore(credential)
    mockedFetch.mockResolvedValueOnce(new Response(null, { status: 401 }) as unknown as Awaited<ReturnType<typeof expoFetch>>)
    const exactTransport = createTransport(exactStore)
    await expect(upload(exactTransport)).rejects.toMatchObject({ code: 'permission_denied' })
    await settleInvalidation()
    expect(exactStore.value).toBeNull()

    const rotatedStore = new MemoryCredentialStore(credential)
    const rotatedCredential = { ...credential, keyId: 'device_key_02', material: 'rotated-secret' }
    mockedFetch.mockImplementationOnce(async () => {
      rotatedStore.value = rotatedCredential
      return new Response(null, { status: 403 }) as unknown as Awaited<ReturnType<typeof expoFetch>>
    })
    const rotatedTransport = createTransport(rotatedStore)
    await expect(upload(rotatedTransport)).rejects.toMatchObject({ code: 'permission_denied' })
    await settleInvalidation()
    expect(rotatedStore.value).toEqual(rotatedCredential)
  })
})

function createTransport(credentialStore: DeviceCredentialStore): SdkDeviceTransport {
  return new SdkDeviceTransport({
    baseUrl: 'https://gateway.example.com',
    credentialStore,
    executeCommand: async () => ({ ok: true, value: null }),
    registry: new CapabilityRegistry(),
    webSocketFactory: { open: () => { throw new Error('unexpected WebSocket') } },
  })
}

function upload(transport: SdkDeviceTransport) {
  return transport.uploadContextObject({
    body: new Blob(['jpeg'], { type: 'image/jpeg' }),
    contentType: 'image/jpeg',
    contextPath: 'camera/photos',
    entryPath: 'phone_01/shot.jpg',
    signal: new AbortController().signal,
  })
}

async function settleInvalidation(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
}
