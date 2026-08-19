import { fireEvent, render } from '@testing-library/react-native'

import { HomeScreen as ProductionHomeScreen } from '../HomeScreen'

import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'
import type { ComponentProps } from 'react'

type TestHomeScreenProps = Omit<
  ComponentProps<typeof ProductionHomeScreen>,
  'onClearGatewayConfiguration' | 'onSaveGatewayConfiguration'
>

function HomeScreen(props: TestHomeScreenProps) {
  return (
    <ProductionHomeScreen
      onClearGatewayConfiguration={jest.fn(async () => undefined)}
      onSaveGatewayConfiguration={jest.fn(async () => undefined)}
      {...props}
    />
  )
}

const readySnapshot: ApplicationSnapshot = {
  appState: 'active',
  attentionSession: null,
  auditRecords: [],
  capabilities: [],
  controlMode: 'ask_every_time',
  deviceId: null,
  error: null,
  gatewayOrigin: null,
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  mediaSession: null,
  mountPath: null,
  pendingConfirmations: [],
  phase: 'ready',
  reachability: 'unconfigured',
  timers: [],
  transportIssue: null,
  transportState: 'unconfigured',
}

describe('HomeScreen', () => {
  test('明确展示 SDK transport 配置状态，并允许紧急停用', async () => {
    const onEmergencyDisable = jest.fn()
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={onEmergencyDisable}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={readySnapshot}
      />,
    )

    rendered.getByText('SDK transport 已接入；请在本机填写 Gateway HTTPS URL 与 API key。', {
      exact: false,
    })
    rendered.getByLabelText('SDK transport：unconfigured')
    await fireEvent.press(rendered.getByRole('button', { name: '紧急停用远程能力' }))
    expect(onEmergencyDisable).toHaveBeenCalledTimes(1)
  })

  test('只在 SDK ready 后展示 online 与网关设备身份', async () => {
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          deviceId: 'device_01',
          mountPath: 'device/device_01',
          reachability: 'online',
          transportState: 'ready',
        }}
      />,
    )

    rendered.getByLabelText('可达性：online')
    rendered.getByLabelText('SDK deviceId：device_01')
    rendered.getByLabelText('挂载路径：device/device_01')
  })

  test('Disabled 模式提供显式恢复入口', async () => {
    const onEnable = jest.fn()
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={onEnable}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{ ...readySnapshot, controlMode: 'disabled', reachability: 'disabled' }}
      />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '恢复为每次确认' }))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  test('运行中的 attention 显示调用方、剩余时间和本地停止入口', async () => {
    const onStopAttention = jest.fn()
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={onStopAttention}
        snapshot={{
          ...readySnapshot,
          attentionSession: {
            callerSubjectId: 'caller_key_01',
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
            remainingSeconds: 30,
            sessionId: 'attention_01',
          },
        }}
      />,
    )

    rendered.getByLabelText('调用方：caller_key_01')
    rendered.getByLabelText('剩余时间：30 秒')
    await fireEvent.press(rendered.getByRole('button', { name: '停止设备提示' }))
    expect(onStopAttention).toHaveBeenCalledTimes(1)
  })

  test('本地确认只展示元数据并提供单次允许/拒绝', async () => {
    const onApproveConfirmation = jest.fn()
    const onRejectConfirmation = jest.fn()
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={onApproveConfirmation}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={onRejectConfirmation}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          pendingConfirmations: [{
            callerDisplayName: 'Fixture Caller',
            callerSubjectId: 'caller_a',
            commandId: 'command_a',
            description: '播放允许的媒体',
            details: [{ label: '来源 hostname', value: 'media.example.com' }],
            effect: 'write',
            expiresAt: '2026-08-19T00:01:00.000Z',
            path: 'phone/media',
            risk: 'medium',
            tool: 'play',
          }],
        }}
      />,
    )

    rendered.getByLabelText('调用方：Fixture Caller')
    rendered.getByLabelText('能力：phone/media.play')
    await fireEvent.press(rendered.getByRole('button', {
      name: '允许 Fixture Caller 调用 phone/media.play 一次',
    }))
    expect(onApproveConfirmation).toHaveBeenCalledWith('command_a')
    await fireEvent.press(rendered.getByRole('button', {
      name: '拒绝 Fixture Caller 调用 phone/media.play',
    }))
    expect(onRejectConfirmation).toHaveBeenCalledWith('command_a')
  })

  test('地图 handoff 确认明确显示目标和本地 provider', async () => {
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          pendingConfirmations: [{
            callerDisplayName: 'Fixture Caller',
            callerSubjectId: 'caller_a',
            commandId: 'map_command',
            description: '把结构化地址或坐标交给用户可见的系统地图处理器',
            details: [{ label: '用途', value: '查看会面地点' }, {
              label: '地图目标', value: 'Sensitive Street 123',
            }, {
              label: '系统处理器', value: 'android_geo_handler',
            }],
            effect: 'write',
            expiresAt: '2026-08-19T00:01:00.000Z',
            path: 'phone/location',
            risk: 'medium',
            tool: 'open_map',
          }],
        }}
      />,
    )

    rendered.getByLabelText('能力：phone/location.open_map')
    rendered.getByLabelText('地图目标：Sensitive Street 123')
    rendered.getByLabelText('系统处理器：android_geo_handler')
  })

  test('系统仍允许请求的通知权限只能由本地 UI 触发', async () => {
    const onRequestNotificationPermission = jest.fn()
    const descriptor = {
      confirmation: 'when_locked' as const,
      description: '创建本地通知',
      effect: 'write' as const,
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
      },
      path: 'phone/productivity',
      queuePolicy: 'reject_offline' as const,
      risk: 'medium' as const,
      tool: 'notify',
    }
    const notDetermined = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={onRequestNotificationPermission}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          capabilities: [{
            availability: {
              reason: 'notification_permission_requestable',
              status: 'unavailable',
            },
            descriptor,
          }],
        }}
      />,
    )
    await fireEvent.press(notDetermined.getByRole('button', { name: '启用本地通知' }))
    expect(onRequestNotificationPermission).toHaveBeenCalledTimes(1)
  })

  test('通知权限拒绝后只提供本地系统设置入口', async () => {
    const descriptor = {
      confirmation: 'when_locked' as const,
      description: '创建本地通知',
      effect: 'write' as const,
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
      },
      path: 'phone/productivity',
      queuePolicy: 'reject_offline' as const,
      risk: 'medium' as const,
      tool: 'notify',
    }
    const onOpenNotificationSettings = jest.fn()
    const denied = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={jest.fn()}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={onOpenNotificationSettings}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          capabilities: [{
            availability: { reason: 'notification_permission_denied', status: 'unavailable' },
            descriptor,
          }],
        }}
      />,
    )
    expect(denied.queryByRole('button', { name: '启用本地通知' })).toBeNull()
    await fireEvent.press(denied.getByRole('button', { name: '打开系统设置' }))
    expect(onOpenNotificationSettings).toHaveBeenCalledTimes(1)
  })

  test('活动计时器展示诚实状态并提供设备本地取消入口', async () => {
    const onCancelTimer = jest.fn()
    const rendered = await render(
      <HomeScreen
        onApproveConfirmation={jest.fn()}
        onCancelTimer={onCancelTimer}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={jest.fn()}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{
          ...readySnapshot,
          timers: [{
            firesAt: '2026-08-19T00:10:00.000Z',
            ownerSubjectId: 'caller_timer',
            state: 'scheduled',
            timerId: `timer_${'a'.repeat(64)}`,
          }],
        }}
      />,
    )

    rendered.getByLabelText('调用方：caller_timer')
    rendered.getByLabelText('目标时间：2026-08-19T00:10:00.000Z')
    rendered.getByText('目标时间不等于系统已准时展示；呈现结果由系统决定。')
    await fireEvent.press(rendered.getByRole('button', {
      name: '取消 caller_timer 在 2026-08-19T00:10:00.000Z 的计时器',
    }))
    expect(onCancelTimer).toHaveBeenCalledWith(`timer_${'a'.repeat(64)}`)
  })

  test('多个计时器和确认请求的操作名称唯一，且不把敏感 detail 放进操作名', async () => {
    const onApproveConfirmation = jest.fn()
    const onCancelTimer = jest.fn()
    const onRejectConfirmation = jest.fn()
    const confirmations = ['one', 'two'].map((suffix, index) => ({
      callerDisplayName: `Caller ${suffix}`,
      callerSubjectId: `caller_${suffix}`,
      commandId: `command_${suffix}`,
      description: '测试确认',
      details: [{ label: '敏感目标', value: `Secret ${index}` }],
      effect: 'write' as const,
      expiresAt: '2026-08-19T00:01:00.000Z',
      path: 'phone/test',
      risk: 'medium' as const,
      tool: `action_${suffix}`,
    }))
    const timers = ['one', 'two'].map((suffix, index) => ({
      firesAt: `2026-08-19T00:${10 + index}:00.000Z`,
      ownerSubjectId: `timer_owner_${suffix}`,
      state: 'scheduled' as const,
      timerId: `timer_${String(index + 1).repeat(64)}`,
    }))
    const rendered = await render(
      <HomeScreen
        focused={false}
        onApproveConfirmation={onApproveConfirmation}
        onCancelTimer={onCancelTimer}
        onEmergencyDisable={jest.fn()}
        onEnable={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRejectConfirmation={onRejectConfirmation}
        onRequestNotificationPermission={jest.fn()}
        onStopAttention={jest.fn()}
        snapshot={{ ...readySnapshot, pendingConfirmations: confirmations, timers }}
      />,
    )

    const firstTimerLabel = '取消 timer_owner_one 在 2026-08-19T00:10:00.000Z 的计时器'
    const secondTimerLabel = '取消 timer_owner_two 在 2026-08-19T00:11:00.000Z 的计时器'
    rendered.getByRole('button', { name: firstTimerLabel })
    await fireEvent.press(rendered.getByRole('button', { name: secondTimerLabel }))
    expect(onCancelTimer).toHaveBeenCalledWith(timers[1]?.timerId)

    const approveLabel = '允许 Caller one 调用 phone/test.action_one 一次'
    const rejectLabel = '拒绝 Caller two 调用 phone/test.action_two'
    await fireEvent.press(rendered.getByRole('button', { name: approveLabel }))
    await fireEvent.press(rendered.getByRole('button', { name: rejectLabel }))
    expect(onApproveConfirmation).toHaveBeenCalledWith('command_one')
    expect(onRejectConfirmation).toHaveBeenCalledWith('command_two')
    const buttonNames = rendered.getAllByRole('button').map(button => button.props.accessibilityLabel)
    expect(new Set(buttonNames).size).toBe(buttonNames.length)
    expect(buttonNames.join(' ')).not.toContain('Secret')
  })
})
