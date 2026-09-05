import { TAB_OPTIONS, TAB_ORDER } from '../navigation'

describe('tab accessibility labels', () => {
  test('三个主 tab 使用稳定、唯一且带上下文的可访问名称', () => {
    const tabs = TAB_ORDER.map(name => TAB_OPTIONS[name])
    expect(tabs.map(tab => tab.title)).toEqual(['信箱', '活动', '设备'])
    expect(new Set(tabs.map(tab => tab.tabBarAccessibilityLabel)).size).toBe(3)
    expect(tabs.every(tab => tab.tabBarAccessibilityLabel.endsWith('标签页'))).toBe(true)
  })
})
