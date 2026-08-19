import { SecureDeviceCredentialStore } from '../deviceCredentialStore'

const credential = {
  audienceOrigin: 'https://gateway.example.com',
  deviceId: 'device_01',
  keyId: 'key_01',
  material: 'opaque-secret-material',
  version: 1 as const,
}

describe('SecureDeviceCredentialStore', () => {
  test('设备凭证只经注入的安全存储保存、读取和清除', async () => {
    let stored: string | null = null
    const store = new SecureDeviceCredentialStore({
      deleteItem: async () => { stored = null },
      getItem: async () => stored,
      setItem: async (_key, value) => { stored = value },
    })

    await store.save(credential)
    expect(stored).toContain('opaque-secret-material')
    await expect(store.get()).resolves.toEqual(credential)
    await store.clear()
    await expect(store.get()).resolves.toBeNull()
  })

  test('拒绝损坏或字段越界的安全存储内容', async () => {
    const store = new SecureDeviceCredentialStore({
      deleteItem: async () => undefined,
      getItem: async () => '{"material":"only"}',
      setItem: async () => undefined,
    })

    await expect(store.get()).rejects.toThrow('凭证 envelope 无效')
    await expect(store.save({ ...credential, audienceOrigin: 'http://gateway.example.com' }))
      .rejects.toThrow('HTTPS origin')
    await expect(store.save({ ...credential, audienceOrigin: 'file:///tmp/gateway' }))
      .rejects.toThrow('audienceOrigin')
  })
})
