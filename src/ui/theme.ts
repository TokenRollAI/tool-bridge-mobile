import { useMemo } from 'react'
import { useColorScheme } from 'react-native'

// 系统外观是唯一主题来源；切换时不重挂载页面或运行时。
export const lightColors = {
  background: '#f4f5f7',
  panel: '#ffffff',
  panelElevated: '#eef1f5',
  border: '#dde2e9',
  outline: '#7b8798',
  text: '#192333',
  muted: '#5e6b7d',
  primary: '#315ecb',
  primarySoft: '#eaf0ff',
  onPrimary: '#ffffff',
  success: '#217553',
  successSoft: '#e8f4ee',
  danger: '#bd3545',
  dangerSoft: '#fff0f1',
  onDanger: '#ffffff',
  warning: '#8b5b0c',
  warningSoft: '#fff4da',
} as const

export type ThemeColors = { readonly [Key in keyof typeof lightColors]: string }

export const darkColors: ThemeColors = {
  background: '#111418',
  panel: '#1b2027',
  panelElevated: '#252c36',
  border: '#333d4a',
  outline: '#748296',
  text: '#edf1f7',
  muted: '#a4afbf',
  primary: '#9ab6ff',
  primarySoft: '#253551',
  onPrimary: '#15213c',
  success: '#80cfac',
  successSoft: '#203a30',
  danger: '#ff9da6',
  dangerSoft: '#412930',
  onDanger: '#37151d',
  warning: '#ebc47f',
  warningSoft: '#3b3324',
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
  lg: 16,
  md: 12,
  sm: 8,
} as const
