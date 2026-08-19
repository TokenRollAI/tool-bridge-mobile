import type { ConfigContext, ExpoConfig } from 'expo/config'

export type AppVariant = 'development' | 'preview' | 'production'

type VariantConfig = Readonly<{
  androidPackage: string
  iosBundleIdentifier: string
  name: string
  scheme: string
  slug: string
}>

export const APP_VARIANTS: Readonly<Record<AppVariant, VariantConfig>> = {
  development: {
    androidPackage: 'ai.tokenroll.toolbridgemobile.dev',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile.dev',
    name: 'Tool Bridge Mobile (Dev)',
    scheme: 'toolbridgemobile-dev',
    slug: 'tool-bridge-mobile-dev',
  },
  preview: {
    androidPackage: 'ai.tokenroll.toolbridgemobile.preview',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile.preview',
    name: 'Tool Bridge Mobile (Preview)',
    scheme: 'toolbridgemobile-preview',
    slug: 'tool-bridge-mobile-preview',
  },
  production: {
    androidPackage: 'ai.tokenroll.toolbridgemobile',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile',
    name: 'Tool Bridge Mobile',
    scheme: 'toolbridgemobile',
    slug: 'tool-bridge-mobile',
  },
}

export function parseAppVariant(value: string | undefined): AppVariant {
  if (value === undefined || value === 'development') return 'development'
  if (value === 'preview' || value === 'production') return value
  throw new Error(`APP_VARIANT 必须是 development、preview 或 production，收到: ${value}`)
}

export function parseMediaHosts(value: string | undefined): readonly string[] {
  return parseHosts(value, 'EXPO_PUBLIC_MEDIA_HOSTS')
}

export function parseLinkHosts(value: string | undefined): readonly string[] {
  return parseHosts(value, 'EXPO_PUBLIC_LINK_HOSTS')
}

function parseHosts(value: string | undefined, variableName: string): readonly string[] {
  if (value === undefined || value.trim() === '') return []
  const hosts = value.split(',').map(host => host.trim().toLowerCase())
  for (const host of hosts) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
      throw new Error(`${variableName} 含无效 hostname: ${host}`)
    }
  }
  return [...new Set(hosts)].sort()
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = parseAppVariant(process.env.APP_VARIANT)
  const variant = APP_VARIANTS[appVariant]

  return {
    ...config,
    name: variant.name,
    slug: variant.slug,
    version: '0.1.0',
    orientation: 'portrait',
    scheme: variant.scheme,
    userInterfaceStyle: 'automatic',
    plugins: [
      'expo-router',
      'expo-dev-client',
      [
        'expo-audio',
        {
          enableBackgroundPlayback: true,
          enableBackgroundRecording: false,
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      [
        'expo-location',
        {
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
          isAndroidMotionActivityEnabled: false,
          isIosBackgroundLocationEnabled: false,
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          locationWhenInUsePermission: '允许 $(PRODUCT_NAME) 仅在您确认后提供一次当前位置。',
          motionUsagePermission: false,
        },
      ],
      ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            minSdkVersion: 24,
            targetSdkVersion: 36,
          },
        },
      ],
      './plugins/withAndroidMapQueries.cjs',
      './plugins/withAndroidDevelopmentPermissionHardening.cjs',
      './plugins/withLocalOnlyNotifications.cjs',
    ],
    experiments: {
      typedRoutes: true,
    },
    ios: {
      bundleIdentifier: variant.iosBundleIdentifier,
      buildNumber: '1',
      deploymentTarget: '16.4',
      supportsTablet: false,
    },
    android: {
      blockedPermissions: [
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_APP_BADGE',
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'com.anddoes.launcher.permission.UPDATE_COUNT',
        'com.google.android.c2dm.permission.RECEIVE',
        'com.htc.launcher.permission.READ_SETTINGS',
        'com.htc.launcher.permission.UPDATE_SHORTCUT',
        'com.huawei.android.launcher.permission.CHANGE_BADGE',
        'com.huawei.android.launcher.permission.READ_SETTINGS',
        'com.huawei.android.launcher.permission.WRITE_SETTINGS',
        'com.majeur.launcher.permission.UPDATE_BADGE',
        'com.oppo.launcher.permission.READ_SETTINGS',
        'com.oppo.launcher.permission.WRITE_SETTINGS',
        'com.sec.android.provider.badge.permission.READ',
        'com.sec.android.provider.badge.permission.WRITE',
        'com.sonyericsson.home.permission.BROADCAST_BADGE',
        'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
        'me.everything.badger.permission.BADGE_COUNT_READ',
        'me.everything.badger.permission.BADGE_COUNT_WRITE',
      ],
      package: variant.androidPackage,
      versionCode: 1,
      permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE'],
    },
    extra: {
      appVariant,
      gatewayOrigin: process.env.EXPO_PUBLIC_GATEWAY_ORIGIN ?? null,
      linkHosts: parseLinkHosts(process.env.EXPO_PUBLIC_LINK_HOSTS),
      mediaHosts: parseMediaHosts(process.env.EXPO_PUBLIC_MEDIA_HOSTS),
      productionTransport: 'unconfigured',
    },
  }
}
