import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'

const DEVICE_CREDENTIAL_KEY = 'tool-bridge-mobile.device-credential.v1'
const unsafeIdentifierCharacter = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}

export const deviceCredentialEnvelopeSchema = z.strictObject({
  audienceOrigin: z.string().max(2048).refine(isHttpsOrigin, 'audienceOrigin 必须是 HTTPS origin'),
  deviceId: z.string().min(1).max(256).refine(
    value => !unsafeIdentifierCharacter.test(value),
    'deviceId 不能包含控制或双向覆盖字符',
  ),
  keyId: z.string().min(1).max(256).refine(
    value => !unsafeIdentifierCharacter.test(value),
    'keyId 不能包含控制或双向覆盖字符',
  ),
  material: z.string().min(1).max(16_384).refine(
    value => !/[\r\n]/.test(value),
    'credential material 不能包含换行',
  ),
  version: z.literal(1),
})

// 本类型只描述安全存储 envelope，不决定上游 credential 的 wire/签发格式。
export type DeviceCredentialEnvelope = z.infer<typeof deviceCredentialEnvelopeSchema>

export interface DeviceCredentialStore {
  clear(): Promise<void>
  get(): Promise<DeviceCredentialEnvelope | null>
  save(credential: DeviceCredentialEnvelope): Promise<void>
}

type SecureKeyValueStore = Readonly<{
  deleteItem(key: string): Promise<void>
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}>

const expoSecureKeyValueStore: SecureKeyValueStore = {
  deleteItem: key => SecureStore.deleteItemAsync(key),
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  }),
}

export class SecureDeviceCredentialStore implements DeviceCredentialStore {
  constructor(private readonly secureStore: SecureKeyValueStore = expoSecureKeyValueStore) {}

  clear(): Promise<void> {
    return this.secureStore.deleteItem(DEVICE_CREDENTIAL_KEY)
  }

  async get(): Promise<DeviceCredentialEnvelope | null> {
    const stored = await this.secureStore.getItem(DEVICE_CREDENTIAL_KEY)
    if (stored === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(stored)
    } catch {
      throw new Error('安全存储中的设备凭证 envelope 无效')
    }
    const credential = deviceCredentialEnvelopeSchema.safeParse(parsed)
    if (!credential.success) throw new Error('安全存储中的设备凭证 envelope 无效')
    return credential.data
  }

  async save(credential: DeviceCredentialEnvelope): Promise<void> {
    const validated = deviceCredentialEnvelopeSchema.parse(credential)
    await this.secureStore.setItem(DEVICE_CREDENTIAL_KEY, JSON.stringify(validated))
  }
}
