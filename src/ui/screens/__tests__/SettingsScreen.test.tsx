import { fireEvent, render } from '@testing-library/react-native'

import { SettingsScreen } from '../SettingsScreen'

import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'
import type { ComponentProps } from 'react'

type TestProps = Omit<
  ComponentProps<typeof SettingsScreen>,
  'onClearGatewayConfiguration' | 'onSaveGatewayConfiguration'
>

function renderSettings(props: TestProps) {
  return render(
    <SettingsScreen
      onClearGatewayConfiguration={jest.fn(async () => undefined)}
      onSaveGatewayConfiguration={jest.fn(async () => undefined)}
      {...props}
    />,
  )
}

const snapshot: ApplicationSnapshot = {
  appState: 'active',
  attentionSession: null,
  auditRecords: [],
  backgroundRuntimeEnabled: false,
  cameraCaptureRequest: null,
  capabilities: [],
  controlMode: 'ask_every_time',
  defaultDeviceId: null,
  deviceId: null,
  error: null,
  gatewayOrigin: null,
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  inboxMessages: [],
  inboxUnreadCount: 0,
  inboxViewOptions: { searchQuery: '', sort: 'received_desc' },
  mediaSession: null,
  mountPath: null,
  pendingConfirmations: [],
  phase: 'ready',
  reachability: 'unconfigured',
  timers: [],
  transportDiagnostic: null,
  transportIssue: null,
  transportState: 'unconfigured',
}

const baseHandlers = {
  onEmergencyDisable: jest.fn(),
  onEnable: jest.fn(),
  onOpenCapabilities: jest.fn(),
  onOpenCameraSettings: jest.fn(),
  onOpenMedia: jest.fn(),
  onOpenNotificationSettings: jest.fn(),
  onOpenStatus: jest.fn(),
  onRequestNotificationPermission: jest.fn(),
  onRequestCameraPermission: jest.fn(),
  onSetBackgroundRuntime: jest.fn(),
  onSetControlMode: jest.fn(),
}

describe('SettingsScreen', () => {
  test('切换控制模式为直接调用并给出高特权提示', async () => {
    const onSetControlMode = jest.fn()
    const rendered = await renderSettings({ ...baseHandlers, onSetControlMode, snapshot })
    await fireEvent.press(rendered.getByRole('button', { name: '允许直接调用（含高危）' }))
    expect(onSetControlMode).toHaveBeenCalledWith('direct_call')
  })

  test('设备信息卡片提供状态、能力与媒体的二级导航入口', async () => {
    const onOpenStatus = jest.fn()
    const onOpenCapabilities = jest.fn()
    const onOpenMedia = jest.fn()
    const rendered = await renderSettings({
      ...baseHandlers,
      onOpenCapabilities,
      onOpenMedia,
      onOpenStatus,
      snapshot,
    })
    await fireEvent.press(rendered.getByRole('button', { name: '设备状态' }))
    await fireEvent.press(rendered.getByRole('button', { name: '设备能力' }))
    await fireEvent.press(rendered.getByRole('button', { name: '媒体会话' }))
    expect(onOpenStatus).toHaveBeenCalledTimes(1)
    expect(onOpenCapabilities).toHaveBeenCalledTimes(1)
    expect(onOpenMedia).toHaveBeenCalledTimes(1)
  })

  test('direct_call 模式展示高特权工具警告', async () => {
    const rendered = await renderSettings({
      ...baseHandlers,
      snapshot: { ...snapshot, controlMode: 'direct_call' },
    })
    rendered.getByText(/高特权工具（shell、剪贴板、任意 URL\/Intent）/)
    rendered.getByText(/前台相机也会在可见预览就绪后自动拍摄并上传/)
  })

  test('后台运行开关切换并传出新值', async () => {
    const onSetBackgroundRuntime = jest.fn()
    const rendered = await renderSettings({ ...baseHandlers, onSetBackgroundRuntime, snapshot })
    await fireEvent.press(rendered.getByRole('switch', { name: '允许后台运行' }))
    expect(onSetBackgroundRuntime).toHaveBeenCalledWith(true)
  })

  test('后台开关反映当前 checked 状态', async () => {
    const rendered = await renderSettings({
      ...baseHandlers,
      snapshot: { ...snapshot, backgroundRuntimeEnabled: true },
    })
    const toggle = rendered.getByRole('switch', { name: '允许后台运行' })
    expect(toggle.props.accessibilityState).toMatchObject({ checked: true })
  })

  test('紧急停用触发回调', async () => {
    const onEmergencyDisable = jest.fn()
    const rendered = await renderSettings({ ...baseHandlers, onEmergencyDisable, snapshot })
    await fireEvent.press(rendered.getByRole('button', { name: '紧急停用远程能力' }))
    expect(onEmergencyDisable).toHaveBeenCalledTimes(1)
  })

  test('Disabled 状态只提供恢复入口，隐藏其他设置', async () => {
    const onEnable = jest.fn()
    const rendered = await renderSettings({
      ...baseHandlers,
      onEnable,
      snapshot: { ...snapshot, controlMode: 'disabled', reachability: 'disabled' },
    })
    expect(rendered.queryByRole('switch', { name: '允许后台运行' })).toBeNull()
    await fireEvent.press(rendered.getByRole('button', { name: '恢复为每次确认' }))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  test('系统仍允许请求的通知权限只能由本地 UI 触发', async () => {
    const onRequestNotificationPermission = jest.fn()
    const rendered = await renderSettings({
      ...baseHandlers,
      onRequestNotificationPermission,
      snapshot: {
        ...snapshot,
        capabilities: [{
          availability: { reason: 'notification_permission_requestable', status: 'unavailable' },
          descriptor: {
            confirmation: 'when_locked',
            description: '创建本地通知',
            effect: 'write',
            limits: { maxResultBytes: 2_048, rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 } },
            path: 'phone/productivity',
            queuePolicy: 'reject_offline',
            risk: 'medium',
            tool: 'notify',
          },
        }],
      },
    })
    await fireEvent.press(rendered.getByRole('button', { name: '启用本地通知' }))
    expect(onRequestNotificationPermission).toHaveBeenCalledTimes(1)
  })

  test('相机权限可请求时只能由本地 UI 启用', async () => {
    const onRequestCameraPermission = jest.fn()
    const rendered = await renderSettings({
      ...baseHandlers,
      onRequestCameraPermission,
      snapshot: {
        ...snapshot,
        capabilities: [{
          availability: {
            permission: 'camera',
            reason: 'camera_permission_required',
            status: 'permission_required',
          },
          descriptor: {
            confirmation: 'always',
            description: '拍摄照片',
            effect: 'write',
            limits: { maxResultBytes: 4_096, rate: { maxGlobal: 4, maxPerCaller: 2, windowSeconds: 60 } },
            path: 'phone/camera',
            queuePolicy: 'reject_offline',
            risk: 'high',
            tool: 'capture_photo',
          },
        }],
      },
    })
    await fireEvent.press(rendered.getByRole('button', { name: '启用前台相机' }))
    expect(onRequestCameraPermission).toHaveBeenCalledTimes(1)
  })
})
