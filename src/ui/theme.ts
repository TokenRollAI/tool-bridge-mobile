import { useMemo } from 'react'
import { useColorScheme } from 'react-native'

// 系统外观是唯一主题来源；切换时不重挂载页面或运行时。
export const lightColors = {
  background: '#ffffff',
  panel: '#f6f6f8',
  slab: '#ffffff',
  panelElevated: '#eeeef2',
  border: '#e4e4e8',
  outline: '#6d6d78',
  text: '#09090b',
  muted: '#52525b',
  primary: '#09090b',
  primarySoft: '#e4e4ea',
  onPrimary: '#ffffff',
  signal: '#8a5a00',
  signalSoft: '#fff4d1',
  success: '#146c43',
  successSoft: '#e8f6ee',
  danger: '#b92534',
  dangerSoft: '#fff0f2',
  onDanger: '#ffffff',
  warning: '#8a5a00',
  warningSoft: '#fff4d1',
} as const

export type ThemeColors = { readonly [Key in keyof typeof lightColors]: string }

export const darkColors: ThemeColors = {
  background: '#09090b',
  panel: '#101013',
  slab: '#16161a',
  panelElevated: '#1e1e24',
  border: '#242429',
  outline: '#8c8c96',
  text: '#f4f4f6',
  muted: '#b4b4bc',
  primary: '#f4f4f6',
  primarySoft: '#292932',
  onPrimary: '#09090b',
  signal: '#f5c451',
  signalSoft: '#2a2210',
  success: '#6ee7a8',
  successSoft: '#13291e',
  danger: '#ff9da6',
  dangerSoft: '#381d23',
  onDanger: '#2b0b12',
  warning: '#f5c451',
  warningSoft: '#2a2210',
}

export function useTheme() {
  const isDark = useColorScheme() === 'dark'
  return { colors: isDark ? darkColors : lightColors, isDark }
}

export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme()
  return useMemo(() => factory(colors), [colors, factory])
}

export const spacing = {
  lg: 16,
  md: 12,
  sm: 8,
  xl: 20,
  xs: 4,
  xxl: 28,
} as const

export const radius = {
  xs: 4,
  sm: 8,
  md: 8,
  lg: 14,
  xl: 20,
  pill: 9999,
} as const
