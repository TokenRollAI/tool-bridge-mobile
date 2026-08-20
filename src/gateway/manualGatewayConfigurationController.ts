import { createManualGatewayCredential } from '@/identity/manualGatewayCredential'

import type { DeviceCredentialStore } from '@/identity/deviceCredentialStore'
import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'

type ReconfigurableTransport = Readonly<{
  updateConfiguration(baseUrl: string | null): Promise<void>
}>

export class ManualGatewayConfigurationController {
  constructor(private readonly dependencies: Readonly<{
    buildGatewayOrigin: string | null
    credentialStore: DeviceCredentialStore
    defaultDeviceId: string
    installationId: string
    transport: ReconfigurableTransport
  }>) {}

  async save(input: ManualGatewayConfigurationInput): Promise<string> {
    const credential = createManualGatewayCredential(input, {
      defaultDeviceId: this.dependencies.defaultDeviceId,
      installationId: this.dependencies.installationId,
    })
    await this.dependencies.transport.updateConfiguration(null)
    try {
      await this.dependencies.credentialStore.save(credential)
    } catch {
      throw new Error('无法把 API key 写入系统安全存储；连接保持关闭')
    }
    await this.dependencies.transport.updateConfiguration(credential.audienceOrigin)
    return credential.audienceOrigin
  }

  async clear(): Promise<string | null> {
    await this.dependencies.transport.updateConfiguration(null)
    try {
      await this.dependencies.credentialStore.clear()
    } catch {
      throw new Error('无法确认 API key 已从系统安全存储清除；连接保持关闭')
    }
    await this.dependencies.transport.updateConfiguration(this.dependencies.buildGatewayOrigin)
    return this.dependencies.buildGatewayOrigin
  }
}
