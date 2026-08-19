import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { focusAccessibilityElement } from '@/ui/accessibility'

import {
  AccessibleAction,
  MINIMUM_ACCESSIBLE_TARGET_SIZE,
} from '../AccessibleAction'
import { Screen } from '../Screen'
import { StatusCard, StatusRow } from '../StatusCard'

jest.mock('@/ui/accessibility', () => ({ focusAccessibilityElement: jest.fn() }))

const focus = focusAccessibilityElement as jest.MockedFunction<typeof focusAccessibilityElement>

describe('shared accessibility components', () => {
  beforeEach(() => { focus.mockClear() })

  test('页面和卡片有 header；StatusRow 只暴露组合后的 label/value 语义', async () => {
    const rendered = await render(
      <Screen focused={false} title="状态">
        <StatusCard title="本机状态">
          <StatusRow label="控制模式" value="disabled" />
        </StatusCard>
      </Screen>,
    )

    rendered.getByRole('header', { name: '状态' })
    rendered.getByRole('header', { name: '本机状态' })
    rendered.getByRole('text', { name: '控制模式：disabled' })
    expect(rendered.queryByText('disabled')).toBeNull()
    expect(JSON.stringify(rendered.toJSON())).not.toContain('"allowFontScaling":false')
    expect(JSON.stringify(rendered.toJSON())).not.toContain('"numberOfLines"')
  })

  test('页面只在 focused 从 false 变 true 时聚焦标题，普通 rerender 不抢焦点', async () => {
    const rendered = await render(
      <Screen focused={false} title="能力"><StatusRow label="状态" value="one" /></Screen>,
    )
    expect(focus).not.toHaveBeenCalled()

    await rendered.rerender(
      <Screen focused title="能力"><StatusRow label="状态" value="one" /></Screen>,
    )
    expect(focus).toHaveBeenCalledTimes(1)

    await rendered.rerender(
      <Screen focused title="能力"><StatusRow label="状态" value="two" /></Screen>,
    )
    expect(focus).toHaveBeenCalledTimes(1)
  })

  test('共享操作具备唯一名称、hint、busy/disabled state 与至少 48dp 目标尺寸', async () => {
    const onPress = jest.fn()
    const rendered = await render(
      <AccessibleAction
        accessibilityHint="等待当前操作完成"
        busy
        label="确认清除活动历史"
        onPress={onPress}
        visualLabel="正在清除…"
      />,
    )
    const action = rendered.getByRole('button', { name: '确认清除活动历史' })
    expect(action.props.accessibilityHint).toBe('等待当前操作完成')
    expect(action.props.accessibilityState).toEqual({ busy: true, disabled: true })
    const style = StyleSheet.flatten(action.props.style)
    expect(style.minHeight).toBeGreaterThanOrEqual(MINIMUM_ACCESSIBLE_TARGET_SIZE)
    expect(style.minWidth).toBeGreaterThanOrEqual(MINIMUM_ACCESSIBLE_TARGET_SIZE)
    fireEvent.press(action)
    expect(onPress).not.toHaveBeenCalled()
  })
})
