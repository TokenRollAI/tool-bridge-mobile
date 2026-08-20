import { StyleSheet, Text, View } from 'react-native'

import { colors, radius, spacing } from '@/ui/theme'

export type PillTone = 'positive' | 'neutral' | 'caution' | 'danger'

const toneColor: Readonly<Record<PillTone, string>> = {
  caution: colors.warning,
  danger: colors.danger,
  neutral: colors.muted,
  positive: colors.primary,
}

// 紧凑的状态徽标：状态点 + label + value。颜色不是唯一信号——
// 文本本身即含义，满足对比度与非仅颜色依赖的无障碍要求。
export function Pill({
  label,
  tone = 'neutral',
  value,
}: Readonly<{ label: string; tone?: PillTone; value: string }>) {
  return (
    <View
      accessibilityLabel={`${label}：${value}`}
      accessibilityRole="text"
      accessible
      style={styles.pill}
    >
      <View style={styles.head}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.dot, { backgroundColor: toneColor[tone] }]}
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
        style={[styles.value, { color: toneColor[tone] }]}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.panelElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  value: {
    fontSize: 16,
    fontWeight: '800',
  },
})
