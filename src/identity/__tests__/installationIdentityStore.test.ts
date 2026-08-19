import { SecureInstallationIdentityStore } from '../installationIdentityStore'

describe('SecureInstallationIdentityStore', () => {
  test('首次生成后只从安全存储读取同一个 installationId', async () => {
    let stored: string | null = null
    const secureStore = {
      getItem: async () => stored,
      setItem: async (_key: string, value: string) => { stored = value },
    }
    const identityStore = new SecureInstallationIdentityStore(
      secureStore,
      () => '00000000-0000-4000-8000-000000000000',
    )

    await expect(identityStore.getOrCreate()).resolves.toBe(
      'installation_00000000-0000-4000-8000-000000000000',
    )
    await expect(identityStore.getOrCreate()).resolves.toBe(
      'installation_00000000-0000-4000-8000-000000000000',
    )
  })

  test('拒绝安全存储中的异常标识，而不是静默换新身份', async () => {
    const identityStore = new SecureInstallationIdentityStore({
      getItem: async () => 'phone_hardware_serial',
      setItem: async () => undefined,
    })

    await expect(identityStore.getOrCreate()).rejects.toThrow('installationId 格式无效')
  })
})
