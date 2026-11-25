import { StyleSheet, Text, View } from 'react-native'

import { useTheme, useThemedStyles, type ThemeColors, radius, spacing } from '@/ui/theme'

export type PillTone = 'positive' | 'neutral' | 'caution' | 'danger'

// 紧凑的状态徽标：状态点 + label + value。颜色不是唯一信号——
// 文本本身即含义，满足对比度与非仅颜色依赖的无障碍要求。
export function Pill({
  label,
  tone = 'neutral',
  value,
}: Readonly<{ label: string; tone?: PillTone; value: string }>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const tones: Readonly<Record<PillTone, readonly [string, string]>> = {
    caution: [colors.warning, colors.warningSoft],
    danger: [colors.danger, colors.dangerSoft],
    neutral: [colors.muted, colors.panelElevated],
    positive: [colors.success, colors.successSoft],
  }
  const [foreground, background] = tones[tone]
  return (
    <View
      accessibilityLabel={`${label}：${value}`}
      accessibilityRole="text"
      accessible
      style={[styles.pill, { backgroundColor: background }]}
    >
      <View style={styles.head}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.dot, { backgroundColor: foreground }]}
        />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.label}
        >
          {label}
        </Text>
      </View>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.value, { color: foreground }]}
      >
        {value}
      </Text>
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  head: {
    alignItems: 'center',
    columnGap: 6,
    flexDirection: 'row',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  pill: {
    borderRadius: radius.lg,
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    flexBasis: 130,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
})
