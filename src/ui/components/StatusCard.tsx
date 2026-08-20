import { StyleSheet, Text, View } from 'react-native'

import { Icon, type IconName } from '@/ui/components/Icon'
import { colors, radius, spacing } from '@/ui/theme'

import type { PropsWithChildren } from 'react'

export function StatusCard({
  children,
  icon,
  title,
  tone = 'neutral',
}: PropsWithChildren<Readonly<{ icon?: IconName; title: string; tone?: 'neutral' | 'danger' }>>) {
  return (
    <View style={[styles.card, tone === 'danger' ? styles.cardDanger : null]}>
      <View style={styles.header}>
        {icon === undefined ? null : (
          <View style={styles.iconBadge}>
            <Icon color={tone === 'danger' ? colors.danger : colors.primary} name={icon} size={16} />
          </View>
        )}
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

export function StatusRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View
      accessibilityLabel={`${label}：${value}`}
      accessibilityRole="text"
      accessible
      style={styles.row}
    >
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.rowLabel}
      >
        {label}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.rowValue}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  cardDanger: {
    borderColor: colors.danger,
  },
  header: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: colors.panelElevated,
    borderRadius: radius.sm,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  row: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.xs,
  },
  rowLabel: {
    color: colors.muted,
    flexBasis: 96,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 13,
  },
  rowValue: {
    color: colors.text,
    flexBasis: 160,
    flexGrow: 2,
    flexShrink: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '700',
  },
})
