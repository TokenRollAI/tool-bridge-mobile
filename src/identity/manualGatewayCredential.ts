import { normalizeDeviceId } from './deviceIdentity'

import type { DeviceCredentialEnvelope } from './deviceCredentialStore'

const INSTALLATION_ID_PATTERN = /^installation_([0-9a-f-]{36})$/
const PRINTABLE_ASCII_WITHOUT_SPACE = /^[\x21-\x7e]+$/

export type ManualGatewayConfigurationInput = Readonly<{
  apiKey: string
  deviceId?: string
  origin: string
}>

export type ManualGatewayIdentity = Readonly<{
  defaultDeviceId: string
  installationId: string
}>

export function normalizeManualGatewayOrigin(value: string): string {
  const candidate = value.trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('Gateway URL 必须是有效的 HTTPS origin')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new Error('Gateway URL 必须是无路径、query、fragment 或 userinfo 的 HTTPS origin')
  }
  return url.origin
}

function validateManualApiKey(value: string): string {
  if (value.length === 0 || value.length > 16_384) {
    throw new Error('API key 长度必须在 1 到 16,384 个字符之间')
  }
  if (!PRINTABLE_ASCII_WITHOUT_SPACE.test(value)) {
    throw new Error('API key 只能包含不含空白的可打印 ASCII 字符')
  }
  return value
}

export function createManualGatewayCredential(
  input: ManualGatewayConfigurationInput,
  identity: ManualGatewayIdentity,
): DeviceCredentialEnvelope {
  const installationMatch = INSTALLATION_ID_PATTERN.exec(identity.installationId)
  if (installationMatch === null) throw new Error('installationId 格式无效')
  const installationUuid = installationMatch[1]
  if (installationUuid === undefined) throw new Error('installationId 格式无效')

  const customDeviceId = input.deviceId?.trim() ?? ''
  const deviceId = customDeviceId === ''
    ? normalizeDeviceId(identity.defaultDeviceId)
    : normalizeDeviceId(customDeviceId)

  return {
    audienceOrigin: normalizeManualGatewayOrigin(input.origin),
    deviceId,
    keyId: `manual_api_key_${installationUuid}`,
    material: validateManualApiKey(input.apiKey),
    version: 1,
  }
}
