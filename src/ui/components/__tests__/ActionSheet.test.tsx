import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'

import { focusAccessibilityElement } from '@/ui/accessibility'

import { ActionSheet } from '../ActionSheet'

jest.mock('@/ui/accessibility', () => ({ focusAccessibilityElement: jest.fn() }))

describe('本地操作面板', () => {
  test('打开后有明确标题和关闭入口；关闭只回调本地关闭操作', async () => {
    const onClose = jest.fn()
    const rendered = await render(<ActionSheet onClose={onClose} title="信箱操作" visible><Text>操作范围</Text></ActionSheet>)
    rendered.getByRole('header', { name: '信箱操作' })
    expect(focusAccessibilityElement).toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '关闭信箱操作' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await rendered.rerender(<ActionSheet onClose={onClose} title="信箱操作" visible={false}><Text>操作范围</Text></ActionSheet>)
    expect(rendered.queryByRole('button', { name: '关闭信箱操作' })).toBeNull()
  })

  test('操作执行中关闭入口表达禁用，不能提前关闭', async () => {
    const onClose = jest.fn()
    const rendered = await render(<ActionSheet dismissible={false} onClose={onClose} title="信箱操作" visible><Text>正在清空</Text></ActionSheet>)
    const close = rendered.getByRole('button', { name: '关闭信箱操作' })
    expect(close.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(close)
    expect(onClose).not.toHaveBeenCalled()
  })
})
