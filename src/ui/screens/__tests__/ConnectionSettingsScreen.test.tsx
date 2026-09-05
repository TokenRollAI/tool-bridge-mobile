import { fireEvent, render } from '@testing-library/react-native'

import { ConnectionSettingsScreen } from '../ConnectionSettingsScreen'

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

describe('连接配置页面', () => {
  test('独立页提供返回入口且网关表单继续向真实保存回调提交', async () => {
    const onBack = jest.fn()
    const onSave = jest.fn(async () => undefined)
    const screen = await render(<ConnectionSettingsScreen onBack={onBack} onClear={jest.fn(async () => undefined)} onSave={onSave} snapshot={snapshot} />)
    await fireEvent.changeText(screen.getByLabelText('Gateway HTTPS URL'), 'https://gateway.example.com')
    await fireEvent.changeText(screen.getByLabelText('Tool Bridge API key'), 'test_secret')
    await fireEvent.press(screen.getByRole('button', { name: '保存 Gateway URL 和 API key 并连接' }))
    expect(onSave).toHaveBeenCalledWith({ origin: 'https://gateway.example.com', apiKey: 'test_secret' })
    await fireEvent.press(screen.getByRole('button', { name: '设备' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  test('停用时不展示凭证编辑入口，要求先回设备页恢复', async () => {
    const screen = await render(<ConnectionSettingsScreen onBack={jest.fn()} onClear={jest.fn(async () => undefined)} onSave={jest.fn(async () => undefined)} snapshot={{ ...snapshot, controlMode: 'disabled' }} />)
    expect(screen.queryByLabelText('Tool Bridge API key')).toBeNull()
    screen.getByText(/请返回设备页恢复为每次确认/)
  })
})
