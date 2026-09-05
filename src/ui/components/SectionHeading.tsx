import { StyleSheet, Text, View } from 'react-native'

import { spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

export function SectionHeading({ title, detail }: Readonly<{ detail?: string; title: string }>) {
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {detail === undefined ? null : <Text style={styles.detail}>{detail}</Text>}
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.sm },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.muted, flexShrink: 1, fontSize: 12, fontVariant: ['tabular-nums'] },
})
