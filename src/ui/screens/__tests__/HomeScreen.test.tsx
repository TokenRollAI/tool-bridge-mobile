import { fireEvent, render } from '@testing-library/react-native'

import { HomeScreen } from '../HomeScreen'

import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

const readySnapshot: ApplicationSnapshot = {
  appState: 'active',
  attentionSession: null,
  auditRecords: [],
  backgroundRuntimeEnabled: false,
  capabilities: [],
  controlMode: 'ask_every_time',
  defaultDeviceId: null,
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
  transportDiagnostic: null,
  transportIssue: null,
  transportState: 'unconfigured',
}

function renderHome(snapshot: ApplicationSnapshot, overrides: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  return render(
    <HomeScreen
      onCancelTimer={jest.fn()}
      onOpenSettings={jest.fn()}
      onStopAttention={jest.fn()}
      snapshot={snapshot}
      {...overrides}
    />,
  )
}

describe('HomeScreen', () => {
  test('总览以状态徽标展示控制模式、连接、后台运行与前后台', async () => {
    const rendered = await renderHome(readySnapshot)
    rendered.getByLabelText('控制模式：每次确认')
    rendered.getByLabelText('连接：unconfigured')
    rendered.getByLabelText('后台运行：已关闭')
    rendered.getByLabelText('前后台：active')
  })

  test('后台运行开启时徽标反映已开启', async () => {
    const rendered = await renderHome({ ...readySnapshot, backgroundRuntimeEnabled: true })
    rendered.getByLabelText('后台运行：已开启')
  })

  test('提供打开设置入口', async () => {
    const onOpenSettings = jest.fn()
    const rendered = await renderHome(readySnapshot, { onOpenSettings })
    await fireEvent.press(rendered.getByRole('button', { name: '打开设置' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  test('只在 SDK ready 后展示 online 与网关设备身份', async () => {
    const rendered = await renderHome({
      ...readySnapshot,
      deviceId: 'device_01',
      mountPath: 'device/device_01',
      reachability: 'online',
      transportState: 'ready',
    })
    rendered.getByLabelText('连接：online')
    rendered.getByLabelText('SDK deviceId：device_01')
    rendered.getByLabelText('挂载路径：device/device_01')
  })

  test('运行中的 attention 显示调用方、剩余时间和本地停止入口', async () => {
    const onStopAttention = jest.fn()
    const rendered = await renderHome({
      ...readySnapshot,
      attentionSession: {
        callerSubjectId: 'caller_key_01',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        remainingSeconds: 30,
        sessionId: 'attention_01',
      },
    }, { onStopAttention })

    rendered.getByLabelText('调用方：caller_key_01')
    rendered.getByLabelText('剩余时间：30 秒')
    await fireEvent.press(rendered.getByRole('button', { name: '停止设备提示' }))
    expect(onStopAttention).toHaveBeenCalledTimes(1)
  })

  test('活动计时器展示诚实状态并提供设备本地取消入口', async () => {
    const onCancelTimer = jest.fn()
    const rendered = await renderHome({
      ...readySnapshot,
      timers: [{
        firesAt: '2026-08-19T00:10:00.000Z',
        ownerSubjectId: 'caller_timer',
        state: 'scheduled',
        timerId: `timer_${'a'.repeat(64)}`,
      }],
    }, { onCancelTimer })

    rendered.getByLabelText('调用方：caller_timer')
    rendered.getByText('目标时间不等于系统已准时展示；呈现结果由系统决定。')
    await fireEvent.press(rendered.getByRole('button', {
      name: '取消 caller_timer 在 2026-08-19T00:10:00.000Z 的计时器',
    }))
    expect(onCancelTimer).toHaveBeenCalledWith(`timer_${'a'.repeat(64)}`)
  })
})
