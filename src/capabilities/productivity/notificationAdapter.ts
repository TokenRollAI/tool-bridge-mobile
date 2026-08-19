import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const LOCAL_NOTIFICATION_CHANNEL_ID = 'tool_bridge_local_requests_v1'
export const LOCAL_NOTIFICATION_IDENTIFIER_PREFIX = 'tb_local_notify_'
export const LOCAL_TIMER_IDENTIFIER_PREFIX = 'tb_local_timer_'
export const LOCAL_TIMER_ID_PREFIX = 'timer_'
const LOCAL_NOTIFICATION_IDENTIFIER = /^tb_local_notify_[a-f0-9]{64}$/
const LOCAL_TIMER_IDENTIFIER = /^tb_local_timer_[a-f0-9]{64}$/

export const LOCAL_NOTIFICATION_CHANNEL: Notifications.NotificationChannelInput = {
  bypassDnd: false,
  description: '用户允许后由 Tool Bridge 创建的本地可见通知',
  enableLights: false,
  enableVibrate: false,
  importance: Notifications.AndroidImportance.DEFAULT,
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  name: 'Tool Bridge 本地通知',
  showBadge: false,
  sound: null,
}

export type NotificationAuthorization =
  | Readonly<{ status: 'granted' }>
  | Readonly<{ status: 'requestable' }>
  | Readonly<{ status: 'denied' }>
  | Readonly<{ status: 'channel_disabled' }>
  | Readonly<{ reason: string; status: 'unavailable' }>

export type LocalNotificationRequest = Readonly<{
  commandId: string
  message: string
}>

export interface LocalNotificationAdapter {
  getAuthorization(): Promise<NotificationAuthorization>
  initialize(): Promise<void>
  requestAuthorization(): Promise<NotificationAuthorization>
  schedule(request: LocalNotificationRequest): Promise<string>
}

export type LocalTimerNotificationRequest = Readonly<{
  firesAt: string
  notificationId: string
}>

export interface LocalTimerNotificationPort {
  cancelScheduled(identifier: string): Promise<void>
  dismissPresented(identifier: string): Promise<void>
  getAuthorization(): Promise<NotificationAuthorization>
  listScheduledIdentifiers(): Promise<ReadonlySet<string>>
  scheduleTimer(request: LocalTimerNotificationRequest): Promise<string>
}

export function isLocalCapabilityNotificationIdentifier(identifier: string): boolean {
  return LOCAL_NOTIFICATION_IDENTIFIER.test(identifier) || LOCAL_TIMER_IDENTIFIER.test(identifier)
}

export function isLocalTimerNotificationIdentifier(identifier: string): boolean {
  return LOCAL_TIMER_IDENTIFIER.test(identifier)
}

export async function deriveLocalTimerIdentifiers(commandId: string): Promise<Readonly<{
  notificationId: string
  timerId: string
}>> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, commandId)
  const normalizedDigest = digest.toLowerCase()
  return {
    notificationId: `${LOCAL_TIMER_IDENTIFIER_PREFIX}${normalizedDigest}`,
    timerId: `${LOCAL_TIMER_ID_PREFIX}${normalizedDigest}`,
  }
}

export function mapAndroidNotificationAuthorization(permissions: Readonly<{
  canAskAgain: boolean
  granted: boolean
  status: string
}>): NotificationAuthorization {
  if (permissions.granted) return { status: 'granted' }
  if (permissions.status === 'undetermined' || permissions.canAskAgain) {
    return { status: 'requestable' }
  }
  return { status: 'denied' }
}

export function buildExpoNotificationRequest(
  request: LocalNotificationRequest,
  platform: 'android' | 'ios' | null,
  identifier: string,
): Notifications.NotificationRequestInput {
  return {
    content: {
      autoDismiss: true,
      body: `Agent 通知：${request.message}`,
      sound: false,
      sticky: false,
      title: 'Tool Bridge',
    },
    identifier,
    trigger: platform === 'android' ? { channelId: LOCAL_NOTIFICATION_CHANNEL_ID } : null,
  }
}

export function buildExpoTimerNotificationRequest(
  request: LocalTimerNotificationRequest,
  platform: 'android' | 'ios' | null,
): Notifications.NotificationRequestInput {
  return {
    content: {
      autoDismiss: true,
      body: 'Agent 计时器已到期',
      sound: false,
      sticky: false,
      title: 'Tool Bridge',
    },
    identifier: request.notificationId,
    trigger: {
      ...(platform === 'android' ? { channelId: LOCAL_NOTIFICATION_CHANNEL_ID } : {}),
      date: Date.parse(request.firesAt),
      type: Notifications.SchedulableTriggerInputTypes.DATE,
    },
  }
}

function nativePlatform(): 'android' | 'ios' | null {
  if (Platform.OS === 'android' || Platform.OS === 'ios') return Platform.OS
  return null
}

function isAndroidChannelSupported(): boolean {
  if (Platform.OS !== 'android') return false
  const version = typeof Platform.Version === 'number'
    ? Platform.Version
    : Number.parseInt(String(Platform.Version), 10)
  return Number.isFinite(version) && version >= 26
}

export class ExpoLocalNotificationAdapter implements LocalNotificationAdapter {
  async initialize(): Promise<void> {
    Notifications.setNotificationHandler({
      handleNotification: async notification => {
        const isLocalCapabilityNotification = isLocalCapabilityNotificationIdentifier(
          notification.request.identifier,
        )
        return {
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: isLocalCapabilityNotification,
          shouldShowList: isLocalCapabilityNotification,
        }
      },
    })
    if (Platform.OS !== 'android') return
    await Notifications.setNotificationChannelAsync(
      LOCAL_NOTIFICATION_CHANNEL_ID,
      LOCAL_NOTIFICATION_CHANNEL,
    )
  }

  async getAuthorization(): Promise<NotificationAuthorization> {
    const platform = nativePlatform()
    if (platform === null) return { reason: 'notification_platform_unsupported', status: 'unavailable' }
    const permissions = await Notifications.getPermissionsAsync()
    if (platform === 'ios') {
      const iosStatus = permissions.ios?.status
      if (
        iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
        || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
        || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
      ) return { status: 'granted' }
      if (iosStatus === Notifications.IosAuthorizationStatus.NOT_DETERMINED) {
        return { status: 'requestable' }
      }
      if (iosStatus === undefined) {
        return { reason: 'notification_permission_status_missing', status: 'unavailable' }
      }
      return { status: 'denied' }
    }

    const androidAuthorization = mapAndroidNotificationAuthorization(permissions)
    if (androidAuthorization.status !== 'granted') return androidAuthorization
    if (isAndroidChannelSupported()) {
      const channel = await Notifications.getNotificationChannelAsync(LOCAL_NOTIFICATION_CHANNEL_ID)
      if (channel === null) {
        return { reason: 'notification_channel_missing', status: 'unavailable' }
      }
      if (channel.importance === Notifications.AndroidImportance.NONE) {
        return { status: 'channel_disabled' }
      }
    }
    return { status: 'granted' }
  }

  async requestAuthorization(): Promise<NotificationAuthorization> {
    await Notifications.requestPermissionsAsync({
      android: {},
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowCriticalAlerts: false,
        allowDisplayInCarPlay: false,
        allowProvisional: false,
        allowSound: false,
        provideAppNotificationSettings: false,
      },
    })
    return this.getAuthorization()
  }

  async schedule(request: LocalNotificationRequest): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      request.commandId,
    )
    const identifier = `${LOCAL_NOTIFICATION_IDENTIFIER_PREFIX}${digest.toLowerCase()}`
    return Notifications.scheduleNotificationAsync(buildExpoNotificationRequest(
      request,
      nativePlatform(),
      identifier,
    ))
  }

  async scheduleTimer(request: LocalTimerNotificationRequest): Promise<string> {
    if (!isLocalTimerNotificationIdentifier(request.notificationId)) {
      throw new Error('timer notification identifier 无效')
    }
    return Notifications.scheduleNotificationAsync(buildExpoTimerNotificationRequest(
      request,
      nativePlatform(),
    ))
  }

  async listScheduledIdentifiers(): Promise<ReadonlySet<string>> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync()
    return new Set(scheduled.map(request => request.identifier))
  }

  async cancelScheduled(identifier: string): Promise<void> {
    if (!isLocalTimerNotificationIdentifier(identifier)) {
      throw new Error('timer notification identifier 无效')
    }
    await Notifications.cancelScheduledNotificationAsync(identifier)
  }

  async dismissPresented(identifier: string): Promise<void> {
    if (!isLocalTimerNotificationIdentifier(identifier)) {
      throw new Error('timer notification identifier 无效')
    }
    await Notifications.dismissNotificationAsync(identifier)
  }
}
