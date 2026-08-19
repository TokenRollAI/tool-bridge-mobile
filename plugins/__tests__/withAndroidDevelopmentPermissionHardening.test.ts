const { removeUnusedDevelopmentPermissions } = jest.requireActual<{
  removeUnusedDevelopmentPermissions(source: string): string
}>('../withAndroidDevelopmentPermissionHardening.cjs')

describe('withAndroidDevelopmentPermissionHardening', () => {
  test('只移除 development overlay 权限并保持其余 manifest 内容', () => {
    const source = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:usesCleartextTraffic="true"/>
</manifest>
`

    const hardened = removeUnusedDevelopmentPermissions(source)
    expect(hardened).not.toContain('SYSTEM_ALERT_WINDOW')
    expect(hardened).toContain('android.permission.INTERNET')
    expect(hardened).toContain('android:usesCleartextTraffic="true"')
  })
})
