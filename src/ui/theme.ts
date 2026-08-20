export const colors = {
  background: '#08111f',
  border: '#26364b',
  danger: '#ff6b6b',
  muted: '#91a4bd',
  outline: '#5a6f8b',
  panel: '#111f31',
  // 卡片内嵌块与输入框的浅一级底色；文字对比仍需满足 themeContrast gate。
  panelElevated: '#18293f',
  primary: '#66d9c8',
  text: '#f5f8fc',
  warning: '#ffd166',
} as const

// 统一间距与圆角刻度；组件不再各自硬编码魔法数。
export const spacing = {
  lg: 16,
  md: 12,
  sm: 8,
  xl: 20,
  xs: 4,
  xxl: 28,
} as const

export const radius = {
  lg: 18,
  md: 14,
  sm: 10,
} as const
