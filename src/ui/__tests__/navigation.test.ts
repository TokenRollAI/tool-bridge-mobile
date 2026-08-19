import { TAB_OPTIONS, TAB_ORDER } from '../navigation'

describe('tab accessibility labels', () => {
  test('四个 tab 使用稳定、唯一且带上下文的可访问名称', () => {
    const tabs = TAB_ORDER.map(name => TAB_OPTIONS[name])
    expect(tabs.map(tab => tab.title)).toEqual(['状态', '能力', '媒体', '活动', '设置'])
    expect(new Set(tabs.map(tab => tab.tabBarAccessibilityLabel)).size).toBe(5)
    expect(tabs.every(tab => tab.tabBarAccessibilityLabel.endsWith('标签页'))).toBe(true)
  })
})
