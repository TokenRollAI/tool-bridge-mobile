import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const INSTALLATION_ID_KEY = 'tool-bridge-mobile.installation-id.v1'
const INSTALLATION_ID_PATTERN = /^installation_[0-9a-f-]{36}$/

export interface InstallationIdentityStore {
  getOrCreate(): Promise<string>
}

type SecureKeyValueStore = Readonly<{
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}>

const expoSecureKeyValueStore: SecureKeyValueStore = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  }),
}

export class SecureInstallationIdentityStore implements InstallationIdentityStore {
  constructor(
    private readonly secureStore: SecureKeyValueStore = expoSecureKeyValueStore,
    private readonly randomUuid: () => string = Crypto.randomUUID,
  ) {}

  async getOrCreate(): Promise<string> {
    const stored = await this.secureStore.getItem(INSTALLATION_ID_KEY)
    if (stored !== null) {
      if (!INSTALLATION_ID_PATTERN.test(stored)) {
        throw new Error('安全存储中的 installationId 格式无效')
      }
      return stored
    }

    const installationId = `installation_${this.randomUuid()}`
    await this.secureStore.setItem(INSTALLATION_ID_KEY, installationId)
    return installationId
  }
}
