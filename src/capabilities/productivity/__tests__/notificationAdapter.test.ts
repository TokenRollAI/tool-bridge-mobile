import * as Notifications from 'expo-notifications'

import {
  buildExpoNotificationRequest,
  buildExpoTimerNotificationRequest,
  deriveLocalTimerIdentifiers,
  isLocalCapabilityNotificationIdentifier,
  isLocalTimerNotificationIdentifier,
  LOCAL_NOTIFICATION_CHANNEL,
  LOCAL_NOTIFICATION_CHANNEL_ID,
  LOCAL_TIMER_IDENTIFIER_PREFIX,
  mapAndroidNotificationAuthorization,
} from '../notificationAdapter'

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, NONE: 2 },
  AndroidNotificationVisibility: { PRIVATE: 2 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}))
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async () => 'A'.repeat(64)),
}))

const notificationId = `tb_local_notify_${'f'.repeat(64)}`
const request = { commandId: 'command_01', message: '请检查任务' }

describe('local notification native boundary', () => {
  test('commandId 经 SHA-256 规范化为两类 deterministic ID', async () => {
    await expect(deriveLocalTimerIdentifiers('command_01')).resolves.toEqual({
      notificationId: `tb_local_timer_${'a'.repeat(64)}`,
      timerId: `timer_${'a'.repeat(64)}`,
    })
  })

  test('只接受精确的本地确定性 identifier', () => {
    expect(isLocalCapabilityNotificationIdentifier(notificationId)).toBe(true)
    expect(isLocalCapabilityNotificationIdentifier('tb_local_notify_remote')).toBe(false)
    expect(isLocalCapabilityNotificationIdentifier(`tb_local_notify_${'g'.repeat(64)}`)).toBe(false)
    expect(isLocalCapabilityNotificationIdentifier(`x${notificationId}`)).toBe(false)
    const timerNotificationId = `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'a'.repeat(64)}`
    expect(isLocalCapabilityNotificationIdentifier(timerNotificationId)).toBe(true)
    expect(isLocalTimerNotificationIdentifier(timerNotificationId)).toBe(true)
    expect(isLocalTimerNotificationIdentifier(`${LOCAL_TIMER_IDENTIFIER_PREFIX}remote`)).toBe(false)
  })

  test('timer 使用绝对 DATE trigger 和固定无敏感正文 payload', () => {
    const timerNotificationId = `${LOCAL_TIMER_IDENTIFIER_PREFIX}${'a'.repeat(64)}`
    const nativeRequest = buildExpoTimerNotificationRequest({
      firesAt: '2026-08-19T00:10:00.000Z',
      notificationId: timerNotificationId,
    }, 'android')
    expect(nativeRequest).toEqual({
      content: {
        autoDismiss: true,
        body: 'Agent 计时器已到期',
        sound: false,
        sticky: false,
        title: 'Tool Bridge',
      },
      identifier: timerNotificationId,
      trigger: {
        channelId: LOCAL_NOTIFICATION_CHANNEL_ID,
        date: Date.parse('2026-08-19T00:10:00.000Z'),
        type: 'date',
      },
    })
    expect(JSON.stringify(nativeRequest)).not.toContain('purpose')
    expect(buildExpoTimerNotificationRequest({
      firesAt: '2026-08-19T00:10:00.000Z',
      notificationId: timerNotificationId,
    }, 'ios').trigger).not.toHaveProperty('channelId')
  })

  test('系统内容固定标识 Tool Bridge，不包含 caller/data/action/sound/badge', () => {
    const nativeRequest = buildExpoNotificationRequest(request, 'android', notificationId)
    expect(nativeRequest).toEqual({
      content: {
        autoDismiss: true,
        body: 'Agent 通知：请检查任务',
        sound: false,
        sticky: false,
        title: 'Tool Bridge',
      },
      identifier: notificationId,
      trigger: { channelId: LOCAL_NOTIFICATION_CHANNEL_ID },
    })
    expect(nativeRequest.content).not.toHaveProperty('data')
    expect(nativeRequest.content).not.toHaveProperty('badge')
    expect(nativeRequest.content).not.toHaveProperty('categoryIdentifier')
    expect(buildExpoNotificationRequest(request, 'ios', notificationId).trigger).toBeNull()
  })

  test('Android channel 不发声、不震动、不亮灯、不 badge 且不绕过 DND', () => {
    expect(LOCAL_NOTIFICATION_CHANNEL).toMatchObject({
      bypassDnd: false,
      enableLights: false,
      enableVibrate: false,
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
      sound: null,
    })
  })

  test('Android fresh install/仍可请求与不可再请求的拒绝语义不同', () => {
    expect(mapAndroidNotificationAuthorization({
      canAskAgain: true,
      granted: false,
      status: 'denied',
    })).toEqual({ status: 'requestable' })
    expect(mapAndroidNotificationAuthorization({
      canAskAgain: false,
      granted: false,
      status: 'denied',
    })).toEqual({ status: 'denied' })
    expect(mapAndroidNotificationAuthorization({
      canAskAgain: false,
      granted: true,
      status: 'granted',
    })).toEqual({ status: 'granted' })
  })
})
