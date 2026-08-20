import type { IconName } from '@/ui/components/Icon'

export const TAB_OPTIONS = {
  activity: { tabBarAccessibilityLabel: '活动标签页', title: '活动' },
  capabilities: { tabBarAccessibilityLabel: '能力标签页', title: '能力' },
  index: { tabBarAccessibilityLabel: '状态标签页', title: '状态' },
  media: { tabBarAccessibilityLabel: '媒体标签页', title: '媒体' },
  settings: { tabBarAccessibilityLabel: '设置标签页', title: '设置' },
} as const

export const TAB_ORDER = ['index', 'capabilities', 'media', 'activity', 'settings'] as const

// 每个 tab 的选中/未选中图标；tab 布局据此渲染 Ionicons，
// 图标只是文字标签的视觉补充，不承担无障碍语义。
export const TAB_ICONS = {
  activity: { active: 'activityActive', inactive: 'activity' },
  capabilities: { active: 'capabilitiesActive', inactive: 'capabilities' },
  index: { active: 'homeActive', inactive: 'home' },
  media: { active: 'mediaActive', inactive: 'media' },
  settings: { active: 'settingsActive', inactive: 'settings' },
} as const satisfies Record<
  (typeof TAB_ORDER)[number],
  Readonly<{ active: IconName; inactive: IconName }>
>
