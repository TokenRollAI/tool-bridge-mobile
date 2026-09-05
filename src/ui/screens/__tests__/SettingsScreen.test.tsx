import { fireEvent, render } from '@testing-library/react-native'

import { SettingsScreen } from '../SettingsScreen'

import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

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

function handlers() {
  return {
    onEmergencyDisable: jest.fn(),
    onEnable: jest.fn(),
    onOpenCapabilities: jest.fn(),
    onOpenConnection: jest.fn(),
    onOpenControls: jest.fn(),
    onOpenMedia: jest.fn(),
    onOpenStatus: jest.fn(),
  }
}

describe('设备总览', () => {
  test('独立入口导航到连接、安全、能力、运行详情和媒体，不直接展示配置表单', async () => {
    const actions = handlers()
    const screen = await render(<SettingsScreen {...actions} snapshot={snapshot} />)
    await fireEvent.press(screen.getByRole('button', { name: '连接配置' }))
    await fireEvent.press(screen.getByRole('button', { name: '授权与安全' }))
    await fireEvent.press(screen.getByRole('button', { name: '设备能力' }))
    await fireEvent.press(screen.getByRole('button', { name: '运行详情' }))
    await fireEvent.press(screen.getByRole('button', { name: '媒体会话' }))
    expect(actions.onOpenConnection).toHaveBeenCalledTimes(1)
    expect(actions.onOpenControls).toHaveBeenCalledTimes(1)
    expect(actions.onOpenCapabilities).toHaveBeenCalledTimes(1)
    expect(actions.onOpenStatus).toHaveBeenCalledTimes(1)
    expect(actions.onOpenMedia).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Tool Bridge API key')).toBeNull()
    expect(screen.queryByRole('switch', { name: '允许后台运行' })).toBeNull()
  })

  test('优先显示已连接设备 ID，没有身份时不编造设备名称', async () => {
    const screen = await render(<SettingsScreen {...handlers()} snapshot={snapshot} />)
    screen.getByText('设备身份准备中')
    await screen.rerender(<SettingsScreen {...handlers()} snapshot={{ ...snapshot, defaultDeviceId: 'local_device' }} />)
    screen.getByText('local_device')
    await screen.rerender(<SettingsScreen {...handlers()} snapshot={{ ...snapshot, defaultDeviceId: 'local_device', deviceId: 'gateway_device' }} />)
    screen.getByText('gateway_device')
    expect(screen.queryByText('local_device')).toBeNull()
  })

  test('只有 SDK ready 显示已连接，网关 origin 本身不代表连接成功', async () => {
    const screen = await render(<SettingsScreen {...handlers()} snapshot={{ ...snapshot, gatewayOrigin: 'https://gateway.example.com' }} />)
    screen.getByText('网关尚未就绪')
    expect(screen.queryByText('已连接网关')).toBeNull()
    await screen.rerender(<SettingsScreen {...handlers()} snapshot={{ ...snapshot, transportState: 'ready', reachability: 'online' }} />)
    screen.getByText('已连接网关')
  })

  test('总览可立即紧急停用，并在停用后恢复为每次确认', async () => {
    const actions = handlers()
    const screen = await render(<SettingsScreen {...actions} snapshot={snapshot} />)
    await fireEvent.press(screen.getByRole('button', { name: '紧急停用远程能力' }))
    expect(actions.onEmergencyDisable).toHaveBeenCalledTimes(1)
    await screen.rerender(<SettingsScreen {...actions} snapshot={{ ...snapshot, controlMode: 'disabled' }} />)
    expect(screen.queryByRole('button', { name: '紧急停用远程能力' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: '恢复为每次确认' }))
    expect(actions.onEnable).toHaveBeenCalledTimes(1)
  })

  test('直接调用模式在总览保留高风险提示', async () => {
    const screen = await render(<SettingsScreen {...handlers()} snapshot={{ ...snapshot, controlMode: 'direct_call' }} />)
    screen.getByText(/直接调用已开启，包括高风险命令/)
  })
})
