import { StyleSheet, Text, View } from 'react-native'

import { Icon, type IconName } from '@/ui/components/Icon'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

export function EmptyState({ icon, title, description }: Readonly<{
  description?: string
  icon: IconName
  title: string
}>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.container}>
      <View style={styles.icon}><Icon color={colors.primary} name={icon} size={28} /></View>
      <Text style={styles.title}>{title}</Text>
      {description === undefined ? null : <Text style={styles.description}>{description}</Text>}
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 44,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 20,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 64,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 22, maxWidth: 320, textAlign: 'center' },
})
