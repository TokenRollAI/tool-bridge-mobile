import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function resolveModules(platform) {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'expo-modules-autolinking', 'resolve', '--platform', platform, '--json'],
    { maxBuffer: 20 * 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

const [android, ios] = await Promise.all([resolveModules('android'), resolveModules('ios')])
const androidAttention = android.modules.find(module => module.packageName === 'tool-bridge-attention')
const iosAttention = ios.modules.find(module => module.packageName === 'tool-bridge-attention')
const androidSystem = android.modules.find(module => module.packageName === 'tool-bridge-system')
const iosSystem = ios.modules.find(module => module.packageName === 'tool-bridge-system')
const androidNotifications = android.modules.find(module => module.packageName === 'expo-notifications')
const iosNotifications = ios.modules.find(module => module.packageName === 'expo-notifications')

if (!androidAttention?.projects?.some(project => project.modules?.some(
  module => module.classifier === 'ai.tokenroll.toolbridge.attention.ToolBridgeAttentionModule',
))) {
  throw new Error('Android ToolBridgeAttentionModule 未被 Expo autolinking 发现')
}

if (!iosAttention?.modules?.some(module => module.class === 'ToolBridgeAttentionModule')) {
  throw new Error('iOS ToolBridgeAttentionModule 未被 Expo autolinking 发现')
}

if (!androidSystem?.projects?.some(project => project.modules?.some(
  module => module.classifier === 'ai.tokenroll.toolbridge.system.ToolBridgeSystemModule',
))) {
  throw new Error('Android ToolBridgeSystemModule 未被 Expo autolinking 发现')
}

if (!iosSystem?.modules?.some(module => module.class === 'ToolBridgeSystemModule')) {
  throw new Error('iOS ToolBridgeSystemModule 未被 Expo autolinking 发现')
}

if (
  androidNotifications?.packageVersion !== '57.0.12'
  || !androidNotifications.projects?.some(project => (
    project.modules?.some(module => (
      module.classifier === 'expo.modules.notifications.permissions.NotificationPermissionsModule'
    ))
    && project.modules?.some(module => (
      module.classifier === 'expo.modules.notifications.notifications.channels.NotificationChannelManagerModule'
    ))
    && project.modules?.some(module => (
      module.classifier === 'expo.modules.notifications.notifications.scheduling.NotificationScheduler'
    ))
  ))
) throw new Error('Android expo-notifications 57.0.12 权限/channel/scheduler 模块未被正确发现')

if (
  iosNotifications?.packageVersion !== '57.0.12'
  || !iosNotifications.pods?.some(pod => pod.podName === 'ExpoNotifications')
  || !iosNotifications.modules?.some(module => module.class === 'PermissionsModule')
  || !iosNotifications.modules?.some(module => module.class === 'SchedulerModule')
) throw new Error('iOS ExpoNotifications 57.0.12 权限/scheduler 模块未被正确发现')

console.log('原生模块验证通过：ToolBridgeAttention、ToolBridgeSystem 与 expo-notifications 57.0.12 已被 Android/iOS autolinking 发现。')
