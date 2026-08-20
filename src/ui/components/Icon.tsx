import Ionicons from '@expo/vector-icons/Ionicons'

import { colors } from '@/ui/theme'

import type { ComponentProps } from 'react'

type IoniconName = ComponentProps<typeof Ionicons>['name']

// 语义化图标名 → Ionicons glyph。屏幕代码只引用语义名，
// 换图标库时只改这一处映射。图标默认对辅助技术隐藏（父级已有文字语义）。
const ICONS = {
  activity: 'time-outline',
  activityActive: 'time',
  alert: 'alert-circle',
  background: 'moon',
  capabilities: 'apps-outline',
  capabilitiesActive: 'apps',
  chevron: 'chevron-forward',
  connection: 'radio',
  danger: 'close-circle',
  disabled: 'power',
  home: 'pulse-outline',
  homeActive: 'pulse',
  media: 'musical-notes-outline',
  mediaActive: 'musical-notes',
  neutral: 'ellipse',
  notification: 'notifications-outline',
  pause: 'pause',
  play: 'play',
  positive: 'checkmark-circle',
  privileged: 'flash',
  resume: 'play',
  settings: 'settings-outline',
  settingsActive: 'settings',
  stop: 'stop',
  timer: 'time-outline',
  trash: 'trash-outline',
  warning: 'warning',
} as const satisfies Record<string, IoniconName>

export type IconName = keyof typeof ICONS

export function Icon({
  color = colors.text,
  name,
  size = 20,
}: Readonly<{ color?: string; name: IconName; size?: number }>) {
  return (
    <Ionicons
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no"
      name={ICONS[name]}
      size={size}
    />
  )
}
