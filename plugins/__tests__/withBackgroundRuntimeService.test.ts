const { addBackgroundRuntimeService } = jest.requireActual<{
  addBackgroundRuntimeService(manifest: AndroidManifestFixture): AndroidManifestFixture
}>('../withBackgroundRuntimeService.cjs')

type ServiceEntry = { $?: Record<string, string> }
type AndroidManifestFixture = {
  manifest: {
    application?: { service?: ServiceEntry[] }[]
  }
}

const SERVICE_NAME = 'ai.tokenroll.toolbridge.system.ToolBridgeForegroundService'

describe('withBackgroundRuntimeService', () => {
  test('注入 non-exported dataSync 前台服务并保留已有服务', () => {
    const manifest: AndroidManifestFixture = {
      manifest: {
        application: [{ service: [{ $: { 'android:name': 'fixture.existing' } }] }],
      },
    }

    addBackgroundRuntimeService(manifest)

    const services = manifest.manifest.application?.[0]?.service ?? []
    expect(services.some(entry => entry.$?.['android:name'] === 'fixture.existing')).toBe(true)
    const injected = services.find(entry => entry.$?.['android:name'] === SERVICE_NAME)
    expect(injected?.$).toMatchObject({
      'android:exported': 'false',
      'android:foregroundServiceType': 'dataSync',
    })
  })

  test('重复应用不产生重复服务声明', () => {
    const manifest: AndroidManifestFixture = { manifest: { application: [{}] } }
    addBackgroundRuntimeService(manifest)
    addBackgroundRuntimeService(manifest)
    const services = manifest.manifest.application?.[0]?.service ?? []
    expect(services.filter(entry => entry.$?.['android:name'] === SERVICE_NAME)).toHaveLength(1)
  })
})
