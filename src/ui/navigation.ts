export const TAB_OPTIONS = {
  activity: { tabBarAccessibilityLabel: '活动标签页', title: '活动' },
  capabilities: { tabBarAccessibilityLabel: '能力标签页', title: '能力' },
  index: { tabBarAccessibilityLabel: '状态标签页', title: '状态' },
  media: { tabBarAccessibilityLabel: '媒体标签页', title: '媒体' },
  settings: { tabBarAccessibilityLabel: '设置标签页', title: '设置' },
} as const

export const TAB_ORDER = ['index', 'capabilities', 'media', 'activity', 'settings'] as const
