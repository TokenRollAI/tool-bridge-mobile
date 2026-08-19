import { StyleSheet, Text, View } from 'react-native'

import { colors } from '@/ui/theme'

export type PillTone = 'positive' | 'neutral' | 'caution' | 'danger'

const toneColor: Readonly<Record<PillTone, string>> = {
  caution: colors.warning,
  danger: colors.danger,
  neutral: colors.muted,
  positive: colors.primary,
}

// 紧凑的状态徽标：用一个词 + 颜色传达状态，替代冗长的 label/value 行。
// 颜色不是唯一信号——文本本身即含义，满足对比度与非仅颜色依赖的无障碍要求。
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
      style={[styles.pill, { borderColor: toneColor[tone] }]}
    >
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.label}
      >
        {label}
      </Text>
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
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  pill: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  value: {
    fontSize: 15,
    fontWeight: '800',
  },
})
