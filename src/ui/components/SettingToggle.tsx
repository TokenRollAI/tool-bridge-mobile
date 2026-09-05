import { Pressable, StyleSheet, Text, View } from 'react-native'

import { MINIMUM_ACCESSIBLE_TARGET_SIZE } from '@/ui/components/AccessibleAction'
import { useThemedStyles, type ThemeColors } from '@/ui/theme'

// 带说明文本的开关行。用 switch role 表达当前状态，整行可点击，满足最小触控尺寸。
export function SettingToggle({
  description,
  disabled = false,
  label,
  onToggle,
  value,
}: Readonly<{
  description: string
  disabled?: boolean
  label: string
  onToggle(next: boolean): void
  value: boolean
}>) {
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => { onToggle(!value) }}
      style={styles.row}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
      </View>
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: MINIMUM_ACCESSIBLE_TARGET_SIZE,
  },
  text: {
    flexShrink: 1,
    gap: 3,
  },
  thumb: {
    backgroundColor: '#ffffff',
    borderRadius: 11,
    height: 22,
    width: 22,
  },
  thumbOff: {
    alignSelf: 'flex-start',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  track: {
    flexShrink: 0,
    borderRadius: 15,
    height: 30,
    padding: 4,
    width: 52,
  },
  trackOff: {
    backgroundColor: colors.outline,
  },
  trackOn: {
    backgroundColor: colors.primary,
  },
})
