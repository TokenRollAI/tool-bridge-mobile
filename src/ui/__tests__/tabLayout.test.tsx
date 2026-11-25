import { fireEvent, renderRouter } from 'expo-router/testing-library'
import { Text } from 'react-native'

import TabsLayout from '../../../app/(tabs)/_layout'

jest.mock('@/runtime/RuntimeProvider', () => ({
  useRuntime: () => ({ snapshot: { inboxUnreadCount: 2 } }),
}))

function Inbox() {
  return <Text>信箱测试内容</Text>
}

function Settings() {
  return <Text>设备测试内容</Text>
}

test('胶囊底栏保留信箱首页、可访问未读提示和设备页导航', async () => {
  const route = renderRouter({
    '(tabs)/_layout': TabsLayout,
    '(tabs)/index': Inbox,
    '(tabs)/settings': Settings,
  })
  const screen = await route

  screen.getByText('信箱测试内容')
  expect(route.getPathname()).toBe('/')
  expect(screen.getByLabelText('信箱标签页，2 条未读')).toBeSelected()
  await fireEvent.press(screen.getByLabelText('设备标签页'))
  screen.getByText('设备测试内容')
  expect(route.getPathname()).toBe('/settings')
  expect(screen.getByLabelText('设备标签页')).toBeSelected()

  await fireEvent.press(screen.getByLabelText('信箱标签页，2 条未读'))
  expect(route.getPathname()).toBe('/')
})
