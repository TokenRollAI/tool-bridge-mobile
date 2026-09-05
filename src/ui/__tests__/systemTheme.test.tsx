import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, useColorScheme } from 'react-native'

import { AccessibleAction } from '../components/AccessibleAction'
import { GatewayConfigurationCard } from '../components/GatewayConfigurationCard'
import { Screen } from '../components/Screen'
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

  test.each([['light', lightColors], ['dark', darkColors]] as const)('%s 危险按钮使用专用前景色', async (scheme, colors) => {
    colorScheme.mockReturnValue(scheme)
    const rendered = await render(<AccessibleAction label="停用" onPress={jest.fn()} variant="danger" />)
    expect(StyleSheet.flatten(rendered.getByText('停用').props.style).color).toBe(colors.onDanger)
    expect(StyleSheet.flatten(rendered.getByRole('button', { name: '停用' }).props.style).backgroundColor).toBe(colors.danger)
  })
})
