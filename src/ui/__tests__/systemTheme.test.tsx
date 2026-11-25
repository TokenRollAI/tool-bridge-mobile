import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, useColorScheme } from 'react-native'

import { AccessibleAction } from '../components/AccessibleAction'
import { GatewayConfigurationCard } from '../components/GatewayConfigurationCard'
import { Screen } from '../components/Screen'
import { SettingToggle } from '../components/SettingToggle'
import { darkColors, lightColors } from '../theme'

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}))

const colorScheme = jest.mocked(useColorScheme)

describe('系统主题切换', () => {
  afterEach(() => { colorScheme.mockReturnValue('light') })

  test('外观变化更新表单颜色并保留未提交内容，不触发保存', async () => {
    const onSave = jest.fn(async () => undefined)
    const ui = () => (
      <Screen focused={false} title="设置">
        <GatewayConfigurationCard currentOrigin={null} defaultDeviceId={null} onClear={jest.fn()} onSave={onSave} />
      </Screen>
    )
    const rendered = await render(ui())
    const input = () => rendered.getByLabelText('Gateway HTTPS URL')
    await fireEvent.changeText(input(), 'https://draft.example.com')
    expect(StyleSheet.flatten(input().props.style).color).toBe(lightColors.text)

    colorScheme.mockReturnValue('dark')
    await rendered.rerender(ui())
    expect(input().props.value).toBe('https://draft.example.com')
    expect(StyleSheet.flatten(input().props.style).color).toBe(darkColors.text)
    expect(onSave).not.toHaveBeenCalled()

    colorScheme.mockReturnValue('light')
    await rendered.rerender(ui())
    expect(input().props.value).toBe('https://draft.example.com')
    expect(StyleSheet.flatten(input().props.style).color).toBe(lightColors.text)
  })

  test.each([['light', lightColors], ['dark', darkColors]] as const)('%s 开关滑块使用与轨道配对的前景色', async (scheme, colors) => {
    colorScheme.mockReturnValue(scheme)
    const onToggle = jest.fn()
    const toggle = (value: boolean) => (
      <SettingToggle description="退到后台时保持连接" label="允许后台运行" onToggle={onToggle} value={value} />
    )
    const rendered = await render(toggle(true))

    for (const checked of [true, false]) {
      await rendered.rerender(toggle(checked))
      const element = rendered.getByRole('switch', { name: '允许后台运行' })
      const track = element.queryAll(view => StyleSheet.flatten(view.props.style)?.width === 52)[0]
      expect(StyleSheet.flatten(track?.props.style)).toMatchObject(checked
        ? { backgroundColor: colors.primary }
        : { backgroundColor: colors.panelElevated, borderColor: colors.outline })
      const thumb = track?.queryAll(view => StyleSheet.flatten(view.props.style)?.width === 22)[0]
      expect(StyleSheet.flatten(thumb?.props.style)?.backgroundColor).toBe(checked ? colors.onPrimary : colors.text)
      expect(element.props.accessibilityState.checked).toBe(checked)
      await fireEvent.press(element)
      expect(onToggle).toHaveBeenLastCalledWith(!checked)
    }
  })

  test.each([['light', lightColors], ['dark', darkColors]] as const)('%s 危险按钮使用专用前景色', async (scheme, colors) => {
    colorScheme.mockReturnValue(scheme)
    const rendered = await render(<AccessibleAction label="停用" onPress={jest.fn()} variant="danger" />)
    expect(StyleSheet.flatten(rendered.getByText('停用').props.style).color).toBe(colors.onDanger)
    expect(StyleSheet.flatten(rendered.getByRole('button', { name: '停用' }).props.style).backgroundColor).toBe(colors.danger)
  })
})
