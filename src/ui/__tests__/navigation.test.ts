import { TAB_OPTIONS, TAB_ORDER, inboxTabAccessibilityLabel } from '../navigation'

describe('tab accessibility labels', () => {
  test('两个主 tab 使用稳定、唯一且带上下文的可访问名称', () => {
    const tabs = TAB_ORDER.map(name => TAB_OPTIONS[name])
    expect(tabs.map(tab => tab.title)).toEqual(['信箱', '设备'])
    expect(new Set(tabs.map(tab => tab.tabBarAccessibilityLabel)).size).toBe(2)
    expect(tabs.every(tab => tab.tabBarAccessibilityLabel.endsWith('标签页'))).toBe(true)
  })

  test('未读提示保留信箱标签页名称，并在清零后消失', () => {
    expect(inboxTabAccessibilityLabel(2)).toBe('信箱标签页，2 条未读')
    expect(inboxTabAccessibilityLabel(0)).toBe(TAB_OPTIONS.index.tabBarAccessibilityLabel)
  })
})
