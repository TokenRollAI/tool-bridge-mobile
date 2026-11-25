import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { lightColors } from '@/ui/theme'

import { PendingConfirmationModal } from '../PendingConfirmationModal'

import type { PendingConfirmationSnapshot } from '@/policy/localConfirmationCoordinator'

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}))

const confirmations: readonly PendingConfirmationSnapshot[] = [{
  callerDisplayName: 'Fixture Caller',
  callerSubjectId: 'caller_a',
  commandId: 'command_a',
  description: '发送一条本地通知',
  details: [{ label: '通知内容', value: 'Sensitive message' }],
  effect: 'write',
  expiresAt: '2026-08-20T00:01:00.000Z',
  path: 'phone/productivity',
  risk: 'medium',
  tool: 'notify',
}, {
  callerDisplayName: null,
  callerSubjectId: 'caller_b',
  commandId: 'command_b',
  description: '打开地图',
  details: [],
  effect: 'write',
  expiresAt: '2026-08-20T00:01:01.000Z',
  path: 'phone/location',
  risk: 'medium',
  tool: 'open_map',
}]

describe('PendingConfirmationModal', () => {
  test('没有请求时不渲染对话框', async () => {
    const rendered = await render(
      <PendingConfirmationModal
        confirmations={[]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    )
    expect(rendered.queryByRole('header', { name: '等待本地确认' })).toBeNull()
  })

  test('全局显示最早请求、队列数量与确认截止，并只裁决当前请求', async () => {
    const onApprove = jest.fn()
    const onReject = jest.fn()
    const rendered = await render(
      <PendingConfirmationModal
        confirmations={confirmations}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(rendered.getAllByRole('header')).toHaveLength(1)
    rendered.getByRole('header', { name: '等待本地确认' })
    rendered.getByText('2 条命令等待处理；当前显示最早的一条')
    rendered.getByLabelText('调用方：Fixture Caller')
    rendered.getByLabelText('能力：phone/productivity.notify')
    rendered.getByLabelText('确认截止：2026-08-20T00:01:00.000Z')
    expect(rendered.queryByLabelText('能力：phone/location.open_map')).toBeNull()

    const approve = rendered.getByRole('button', {
      name: '允许 Fixture Caller 调用 phone/productivity.notify 一次',
    })
    const reject = rendered.getByRole('button', {
      name: '拒绝 Fixture Caller 调用 phone/productivity.notify',
    })
    expect(`${approve.props.accessibilityLabel} ${reject.props.accessibilityLabel}`)
      .not.toContain('Sensitive message')
    expect(StyleSheet.flatten(reject.props.style).backgroundColor).toBe(lightColors.panelElevated)
    expect(StyleSheet.flatten(approve.props.style).backgroundColor).toBe(lightColors.primary)
    await fireEvent.press(approve)
    await fireEvent.press(reject)
    expect(onApprove).toHaveBeenCalledWith('command_a')
    expect(onReject).toHaveBeenCalledWith('command_a')

    await rendered.rerender(
      <PendingConfirmationModal confirmations={confirmations.slice(1)} onApprove={onApprove} onReject={onReject} />,
    )
    rendered.getByText('1 条命令等待处理')
    await fireEvent.press(rendered.getByRole('button', { name: '拒绝 caller_b 调用 phone/location.open_map' }))
    expect(onReject).toHaveBeenLastCalledWith('command_b')
  })
})
