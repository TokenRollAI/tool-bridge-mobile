const {
  hardenLocalOnlyAndroidManifest,
  removePushEntitlement,
} = jest.requireActual<{
  hardenLocalOnlyAndroidManifest(manifest: Record<string, any>): Record<string, any>
  removePushEntitlement(entitlements: Record<string, unknown>): Record<string, unknown>
}>('../withLocalOnlyNotifications.cjs')

describe('withLocalOnlyNotifications', () => {
  test('只移除自动通知插件加入的 APNs entitlement', () => {
    const entitlements = {
      'aps-environment': 'development',
      'com.apple.security.application-groups': ['group.fixture'],
    }

    expect(removePushEntitlement(entitlements)).toEqual({
      'com.apple.security.application-groups': ['group.fixture'],
    })
  })

  test('Android 只保留 local notification event receiver，移除 remote/boot 入口', () => {
    const manifest = {
      manifest: {
        application: [{
          provider: [],
          receiver: [{ $: { 'android:name': 'fixture.receiver' } }],
          service: [{ $: { 'android:name': 'fixture.service' } }],
        }],
      },
    }

    const hardened = hardenLocalOnlyAndroidManifest(manifest)
    const application = hardened.manifest.application[0]
    expect(application.service).toContainEqual({
      $: {
        'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService',
        'tools:node': 'remove',
      },
    })
    expect(application.provider).toContainEqual({
      $: {
        'android:name': 'com.google.firebase.provider.FirebaseInitProvider',
        'tools:node': 'remove',
      },
    })
    expect(application.receiver).toContainEqual(expect.objectContaining({
      $: expect.objectContaining({
        'android:name': 'com.google.firebase.iid.FirebaseInstanceIdReceiver',
        'tools:node': 'remove',
      }),
    }))
    const localReceiver = application.receiver.find((entry: any) => (
      entry.$?.['android:name'] === 'expo.modules.notifications.service.NotificationsService'
    ))
    expect(localReceiver).toEqual({
      $: {
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:name': 'expo.modules.notifications.service.NotificationsService',
        'tools:node': 'replace',
      },
      'intent-filter': [{
        $: { 'android:priority': '-1' },
        action: [{ $: { 'android:name': 'expo.modules.notifications.NOTIFICATION_EVENT' } }],
      }],
    })
    expect(JSON.stringify(localReceiver)).not.toMatch(/BOOT|REBOOT|firebase/u)
    expect(application.service).toContainEqual({ $: { 'android:name': 'fixture.service' } })
  })
})
