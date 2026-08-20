import type { ConfigContext, ExpoConfig } from 'expo/config'

export type AppVariant = 'development' | 'preview' | 'production'

type VariantConfig = Readonly<{
  androidPackage: string
  iosBundleIdentifier: string
  name: string
  scheme: string
}>

export const EXPO_OWNER = 'tokenroll'
export const EAS_PROJECT_ID = '378c7a3e-437a-49a6-ae20-fef5af6f6188'
export const EXPO_PROJECT_SLUG = 'tool-bridge'
export const APP_VERSION = '0.0.5'
export const ANDROID_VERSION_CODE = 5
export const IOS_BUILD_NUMBER = '5'

export const APP_VARIANTS: Readonly<Record<AppVariant, VariantConfig>> = {
  development: {
    androidPackage: 'ai.tokenroll.toolbridgemobile.dev',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile.dev',
    name: 'Tool Bridge Mobile (Dev)',
    scheme: 'toolbridgemobile-dev',
  },
  preview: {
    androidPackage: 'ai.tokenroll.toolbridgemobile.preview',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile.preview',
    name: 'Tool Bridge Mobile (Preview)',
    scheme: 'toolbridgemobile-preview',
  },
  production: {
    androidPackage: 'ai.tokenroll.toolbridgemobile',
    iosBundleIdentifier: 'ai.tokenroll.toolbridgemobile',
    name: 'Tool Bridge Mobile',
    scheme: 'toolbridgemobile',
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

export function parseGatewayOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  const normalized = value.trim()
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('EXPO_PUBLIC_GATEWAY_ORIGIN 必须是有效的 HTTPS origin')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.origin !== normalized
  ) {
    throw new Error('EXPO_PUBLIC_GATEWAY_ORIGIN 必须是无路径、query、fragment 或 userinfo 的 HTTPS origin')
  }
  return url.origin
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
    owner: EXPO_OWNER,
    slug: EXPO_PROJECT_SLUG,
    version: APP_VERSION,
    orientation: 'portrait',
    scheme: variant.scheme,
    userInterfaceStyle: 'automatic',
    // 全部图标由 assets/icon/brand-mark.svg 这一份矢量源导出（pnpm icons:generate）。
    icon: './assets/icon/app-icon.png',
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
      './plugins/withBackgroundRuntimeService.cjs',
    ],
    experiments: {
      typedRoutes: true,
    },
    ios: {
      bundleIdentifier: variant.iosBundleIdentifier,
      buildNumber: IOS_BUILD_NUMBER,
      deploymentTarget: '16.4',
      supportsTablet: false,
      // iOS 应用图标不支持透明通道，直接复用带深色底的方形图标。
      icon: './assets/icon/app-icon.png',
    },
    android: {
      adaptiveIcon: {
        // 前景层留透明，背景色走 theme.colors.background，避免双层底色叠加。
        backgroundColor: '#08111f',
        foregroundImage: './assets/icon/adaptive-icon.png',
        // Android 13+ 主题化图标：系统按壁纸取色重新着色，只读取 alpha 通道。
        monochromeImage: './assets/icon/monochrome-icon.png',
      },
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
      versionCode: ANDROID_VERSION_CODE,
      permissions: [
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.VIBRATE',
      ],
    },
    web: {
      favicon: './assets/icon/favicon.png',
    },
    extra: {
      eas: {
        projectId: EAS_PROJECT_ID,
      },
      appVariant,
      gatewayOrigin: parseGatewayOrigin(process.env.EXPO_PUBLIC_GATEWAY_ORIGIN),
      linkHosts: parseLinkHosts(process.env.EXPO_PUBLIC_LINK_HOSTS),
      mediaHosts: parseMediaHosts(process.env.EXPO_PUBLIC_MEDIA_HOSTS),
      productionTransport: '@tool-bridge/sdk/device@0.11.0',
    },
  }
}
