import { ManualGatewayConfigurationController } from '../manualGatewayConfigurationController'

import type { DeviceCredentialEnvelope } from '@/identity/deviceCredentialStore'

const input = {
  apiKey: 'tb_sk_fixture_secret',
  origin: 'https://gateway.example.com/',
}

function createHarness(options: Readonly<{
  clearFails?: boolean
  saveFails?: boolean
}> = {}) {
  const events: string[] = []
  let stored: DeviceCredentialEnvelope | null = null
  const controller = new ManualGatewayConfigurationController({
    buildGatewayOrigin: 'https://build-gateway.example.com',
    credentialStore: {
      clear: async () => {
        events.push('credential:clear')
        if (options.clearFails === true) throw new Error('fixture clear failed')
        stored = null
      },
      get: async () => stored,
      save: async credential => {
        events.push('credential:save')
        if (options.saveFails === true) throw new Error('fixture save failed')
        stored = credential
      },
    },
    installationId: 'installation_00000000-0000-4000-8000-000000000000',
    transport: {
      updateConfiguration: async baseUrl => {
        events.push(`transport:${baseUrl ?? 'null'}`)
      },
    },
  })
  return { controller, events, readStored: () => stored }
}

describe('ManualGatewayConfigurationController', () => {
  test('保存严格按停止旧连接、写 SecureStore、连接新 audience 的顺序执行', async () => {
    const harness = createHarness()
    await expect(harness.controller.save(input)).resolves.toBe('https://gateway.example.com')
    expect(harness.events).toEqual([
      'transport:null',
      'credential:save',
      'transport:https://gateway.example.com',
    ])
    expect(harness.readStored()).toMatchObject({
      audienceOrigin: 'https://gateway.example.com',
      material: 'tb_sk_fixture_secret',
    })
  })

  test('SecureStore 写入失败时保持 transport 关闭且不回显底层错误', async () => {
    const harness = createHarness({ saveFails: true })
    await expect(harness.controller.save(input)).rejects.toThrow(
      '无法把 API key 写入系统安全存储；连接保持关闭',
    )
    expect(harness.events).toEqual(['transport:null', 'credential:save'])
  })

  test('清除严格按停止连接、删除 API key、恢复构建预置 URL 的顺序执行', async () => {
    const harness = createHarness()
    await expect(harness.controller.clear()).resolves.toBe('https://build-gateway.example.com')
    expect(harness.events).toEqual([
      'transport:null',
      'credential:clear',
      'transport:https://build-gateway.example.com',
    ])
  })

  test('SecureStore 清除失败时保持 transport 关闭，不重新使用未确认删除的 key', async () => {
    const harness = createHarness({ clearFails: true })
    await expect(harness.controller.clear()).rejects.toThrow(
      '无法确认 API key 已从系统安全存储清除；连接保持关闭',
    )
    expect(harness.events).toEqual(['transport:null', 'credential:clear'])
  })
})
