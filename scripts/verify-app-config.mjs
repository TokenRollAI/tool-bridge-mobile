import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const variants = {
  development: 'ai.tokenroll.toolbridgemobile.dev',
  preview: 'ai.tokenroll.toolbridgemobile.preview',
  production: 'ai.tokenroll.toolbridgemobile',
}

const easProject = {
  id: '378c7a3e-437a-49a6-ae20-fef5af6f6188',
  owner: 'tokenroll',
  slug: 'tool-bridge',
}

const releaseMetadata = {
  androidVersionCode: 2,
  iosBuildNumber: '2',
  version: '0.0.2',
}

for (const [variant, expectedIdentifier] of Object.entries(variants)) {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'expo', 'config', '--type', 'public', '--json'],
    {
      env: {
        ...process.env,
        APP_VARIANT: variant,
        EXPO_PUBLIC_GATEWAY_ORIGIN: 'https://gateway.example.com',
        EXPO_PUBLIC_LINK_HOSTS: 'www.example.com,docs.example.com',
        EXPO_PUBLIC_MEDIA_HOSTS: 'media.example.com,cdn.example.com',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const config = JSON.parse(stdout)
  if (config.android?.package !== expectedIdentifier) {
    throw new Error(`${variant}: Android applicationId 不匹配`)
  }
  if (config.ios?.bundleIdentifier !== expectedIdentifier) {
    throw new Error(`${variant}: iOS bundleIdentifier 不匹配`)
  }
  if (config.extra?.appVariant !== variant) {
    throw new Error(`${variant}: extra.appVariant 不匹配`)
  }
  if (config.owner !== easProject.owner || config.slug !== easProject.slug) {
    throw new Error(`${variant}: Expo owner/slug 未绑定到 @${easProject.owner}/${easProject.slug}`)
  }
  if (config.extra?.eas?.projectId !== easProject.id) {
    throw new Error(`${variant}: EAS projectId 不匹配`)
  }
  if (
    config.version !== releaseMetadata.version
    || config.android?.versionCode !== releaseMetadata.androidVersionCode
    || config.ios?.buildNumber !== releaseMetadata.iosBuildNumber
  ) {
    throw new Error(`${variant}: App 版本或平台 build number 不匹配`)
  }
  if (config.extra?.gatewayOrigin !== 'https://gateway.example.com') {
    throw new Error(`${variant}: gateway HTTPS origin 未规范化`)
  }
  if (config.extra?.productionTransport !== '@tool-bridge/sdk/device@0.11.0') {
    throw new Error(`${variant}: production transport 版本标记不匹配`)
  }
  if (!config.android?.permissions?.includes('android.permission.VIBRATE')) {
    throw new Error(`${variant}: 缺少 P1-A haptic 所需的 Android VIBRATE 权限`)
  }
  if (!config.android?.permissions?.includes('android.permission.POST_NOTIFICATIONS')) {
    throw new Error(`${variant}: 缺少本地通知所需的 Android POST_NOTIFICATIONS 权限`)
  }
  const blockedPermissions = new Set(config.android?.blockedPermissions ?? [])
  for (const permission of [
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.READ_APP_BADGE',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'com.google.android.c2dm.permission.RECEIVE',
    'com.sec.android.provider.badge.permission.READ',
    'com.sec.android.provider.badge.permission.WRITE',
  ]) {
    if (!blockedPermissions.has(permission)) {
      throw new Error(`${variant}: 未显式阻止不需要的 Android 权限 ${permission}`)
    }
  }
  if (JSON.stringify(config.extra?.mediaHosts) !== JSON.stringify(['cdn.example.com', 'media.example.com'])) {
    throw new Error(`${variant}: 媒体 hostname allowlist 未规范化`)
  }
  if (JSON.stringify(config.extra?.linkHosts) !== JSON.stringify(['docs.example.com', 'www.example.com'])) {
    throw new Error(`${variant}: handoff hostname allowlist 未规范化`)
  }
}

const { stdout: introspectionOutput } = await execFileAsync(
  'pnpm',
  ['exec', 'expo', 'config', '--type', 'introspect', '--json'],
  {
    env: {
      ...process.env,
      APP_VARIANT: 'development',
      EXPO_PUBLIC_GATEWAY_ORIGIN: 'https://gateway.example.com',
      EXPO_PUBLIC_LINK_HOSTS: 'www.example.com',
      EXPO_PUBLIC_MEDIA_HOSTS: 'media.example.com',
    },
    maxBuffer: 20 * 1024 * 1024,
  },
)
const introspection = JSON.parse(introspectionOutput)._internal?.modResults
const androidManifest = introspection?.android?.manifest?.manifest
const androidPermissions = new Set(
  androidManifest?.['uses-permission']
    ?.filter(entry => entry.$?.['tools:node'] !== 'remove')
    .map(entry => entry.$?.['android:name']) ?? [],
)
for (const permission of [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
]) {
  if (!androidPermissions.has(permission)) throw new Error(`原生配置缺少 ${permission}`)
}
for (const forbiddenPermission of [
  'android.permission.CAMERA',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.RECORD_AUDIO',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.READ_APP_BADGE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'com.google.android.c2dm.permission.RECEIVE',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
]) {
  if (androidPermissions.has(forbiddenPermission)) {
    throw new Error(`未实现能力不得声明 ${forbiddenPermission}`)
  }
}
const androidServices = androidManifest?.application?.flatMap(
  application => application.service ?? [],
) ?? []
const androidReceivers = androidManifest?.application?.flatMap(
  application => application.receiver ?? [],
) ?? []
const androidProviders = androidManifest?.application?.flatMap(
  application => application.provider ?? [],
) ?? []
const androidQueryIntents = androidManifest?.queries?.flatMap(
  query => query.intent ?? [],
) ?? []
if (!androidQueryIntents.some(intent => (
  intent.action?.some(action => action.$?.['android:name'] === 'android.intent.action.VIEW')
  && intent.data?.some(data => data.$?.['android:scheme'] === 'geo')
))) {
  throw new Error('Android 缺少 open_map 所需的最小 geo handler query')
}
if (!androidServices.some(service => (
  service.$?.['android:name'] === 'expo.modules.audio.service.AudioControlsService'
  && service.$?.['android:exported'] === 'false'
  && service.$?.['android:foregroundServiceType'] === 'mediaPlayback'
))) {
  throw new Error('Android 后台媒体 service 缺失或配置不安全')
}
for (const name of [
  'expo.modules.notifications.service.ExpoFirebaseMessagingService',
  'com.google.firebase.messaging.FirebaseMessagingService',
  'com.google.firebase.components.ComponentDiscoveryService',
]) {
  if (!androidServices.some(service => (
    service.$?.['android:name'] === name && service.$?.['tools:node'] === 'remove'
  ))) throw new Error(`local-only Android 配置未移除 remote service ${name}`)
}
if (!androidProviders.some(provider => (
  provider.$?.['android:name'] === 'com.google.firebase.provider.FirebaseInitProvider'
  && provider.$?.['tools:node'] === 'remove'
))) throw new Error('local-only Android 配置未移除 FirebaseInitProvider')
const localNotificationReceiver = androidReceivers.find(receiver => (
  receiver.$?.['android:name'] === 'expo.modules.notifications.service.NotificationsService'
))
const localNotificationActions = localNotificationReceiver?.['intent-filter']?.flatMap(
  filter => filter.action?.map(action => action.$?.['android:name']) ?? [],
) ?? []
if (
  localNotificationReceiver?.$?.['tools:node'] !== 'replace'
  || JSON.stringify(localNotificationActions) !== JSON.stringify([
    'expo.modules.notifications.NOTIFICATION_EVENT',
  ])
) throw new Error('local-only Android receiver 不得保留 boot/remote action')
const iosInfo = introspection?.ios?.infoPlist
const iosEntitlements = introspection?.ios?.entitlements
if (JSON.stringify(iosInfo?.UIBackgroundModes) !== JSON.stringify(['audio'])) {
  throw new Error('iOS 只应声明 audio background mode')
}
if (iosInfo?.NSLocationWhenInUseUsageDescription !== '允许 $(PRODUCT_NAME) 仅在您确认后提供一次当前位置。') {
  throw new Error('iOS 前台位置 purpose string 缺失或不一致')
}
if (
  iosInfo?.NSLocationAlwaysUsageDescription !== undefined
  || iosInfo?.NSLocationAlwaysAndWhenInUseUsageDescription !== undefined
  || iosInfo?.NSMotionUsageDescription !== undefined
) {
  throw new Error('一次性前台位置不得生成 Always/background/motion usage description')
}
if (iosInfo?.NSMicrophoneUsageDescription !== undefined || iosInfo?.NSFaceIDUsageDescription !== undefined) {
  throw new Error('未使用麦克风或 Face ID 时不得生成 usage description')
}
if (iosEntitlements?.['aps-environment'] !== undefined) {
  throw new Error('本地通知切片不得声明 APNs aps-environment entitlement')
}

console.log('App 配置验证通过：三环境安装标识隔离并绑定同一 EAS 项目，本地通知/前台位置/地图/媒体配置最小化，无 APNs/后台位置/录音/相机/Face ID。')
