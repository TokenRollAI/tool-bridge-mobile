import type { IconName } from '@/ui/components/Icon'

// 主导航只保留三个高频入口：信箱（落地首页）、活动、设置。
// 状态、能力、媒体降级为设置页内的二级页面，不再占用 tab bar。
export const TAB_OPTIONS = {
  activity: { tabBarAccessibilityLabel: '活动标签页', title: '活动' },
  index: { tabBarAccessibilityLabel: '信箱标签页', title: '信箱' },
  settings: { tabBarAccessibilityLabel: '设置标签页', title: '设置' },
} as const

export const TAB_ORDER = ['index', 'activity', 'settings'] as const

// 每个 tab 的选中/未选中图标；tab 布局据此渲染 Ionicons，
// 图标只是文字标签的视觉补充，不承担无障碍语义。
export const TAB_ICONS = {
  activity: { active: 'activityActive', inactive: 'activity' },
  index: { active: 'inboxActive', inactive: 'inbox' },
  settings: { active: 'settingsActive', inactive: 'settings' },
} as const satisfies Record<
  (typeof TAB_ORDER)[number],
  Readonly<{ active: IconName; inactive: IconName }>
>
