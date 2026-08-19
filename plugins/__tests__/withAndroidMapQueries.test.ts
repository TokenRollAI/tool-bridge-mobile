const { ensureAndroidMapQueries } = jest.requireActual<{
  ensureAndroidMapQueries(manifest: AndroidManifestFixture): AndroidManifestFixture
}>('../withAndroidMapQueries.cjs')

type AndroidManifestFixture = {
  manifest: {
    queries?: {
      intent?: {
        action?: { $?: Record<string, string> }[]
        data?: { $?: Record<string, string> }[]
      }[]
      package?: { $?: Record<string, string> }[]
    }[]
  }
}

describe('withAndroidMapQueries', () => {
  test('加入最小 geo ACTION_VIEW 查询并保持已有 package query', () => {
    const manifest: AndroidManifestFixture = {
      manifest: {
        queries: [{ package: [{ $: { 'android:name': 'fixture.existing' } }] }],
      },
    }

    ensureAndroidMapQueries(manifest)

    expect(manifest.manifest.queries?.[0]?.package).toHaveLength(1)
    expect(manifest.manifest.queries?.[0]?.intent).toEqual([{
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': 'geo' } }],
    }])
    ensureAndroidMapQueries(manifest)
    expect(manifest.manifest.queries?.[0]?.intent).toHaveLength(1)
  })
})
