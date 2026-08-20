import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'

// 与上游网关 assertDeviceId 的 DO 路由约束对齐（[A-Za-z0-9._-]），并附加本地长度上限。
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const DEFAULT_DEVICE_ID_LENGTH = 12

// 域分隔盐：同一硬件标识在其它用途下派生的摘要不会与设备 ID 相同。
const DEVICE_ID_SEED_NAMESPACE = 'tool-bridge-mobile.device-id.v1'

export type Sha256Hex = (value: string) => Promise<string>

const expoSha256Hex: Sha256Hex = value => Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  value,
)

export function normalizeDeviceId(value: string): string {
  const candidate = value.trim()
  if (!DEVICE_ID_PATTERN.test(candidate)) {
    throw new Error("设备 ID 只能包含 1 到 64 个字母、数字、'.'、'_' 或 '-'")
  }
  return candidate
}

export async function deriveSeededDeviceId(
  seed: string,
  digest: Sha256Hex = expoSha256Hex,
): Promise<string> {
  if (seed.trim() === '') throw new Error('设备 ID seed 不能为空')
  const digestHex = await digest(`${DEVICE_ID_SEED_NAMESPACE}:${seed}`)
  const deviceId = digestHex.toLowerCase().slice(0, DEFAULT_DEVICE_ID_LENGTH)
  return normalizeDeviceId(deviceId)
}

// Android ID 绑定 设备+签名+用户，同签名重装保持不变；IDFV 在同厂商任一 App 仍安装时保持不变。
// 两者都不可用时返回 null，由调用方回退到持久化 installation identity。
export async function readHardwareDeviceSeed(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      const androidId = Application.getAndroidId()
      return androidId.trim() === '' ? null : `android:${androidId}`
    }
    if (Platform.OS === 'ios') {
      const vendorId = await Application.getIosIdForVendorAsync()
      return vendorId === null || vendorId.trim() === '' ? null : `ios:${vendorId}`
    }
    return null
  } catch {
    return null
  }
}

export async function resolveDefaultDeviceId(
  installationId: string,
  options?: Readonly<{
    digest?: Sha256Hex
    hardwareSeed?: () => Promise<string | null>
  }>,
): Promise<string> {
  const readSeed = options?.hardwareSeed ?? readHardwareDeviceSeed
  try {
    const seed = await readSeed() ?? `installation:${installationId}`
    return await deriveSeededDeviceId(seed, options?.digest)
  } catch {
    // digest 原生模块不可用时的最终兜底：直接取 installation UUID 的十六进制字符，
    // 仍是持久化来源，避免让整个 runtime 初始化失败。
    const uuid = installationId.replace(/^installation_/, '')
    const fallback = uuid.replace(/[^0-9a-f]/g, '').slice(0, DEFAULT_DEVICE_ID_LENGTH)
    return normalizeDeviceId(fallback)
  }
}
