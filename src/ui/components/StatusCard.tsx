import { StyleSheet, Text, View } from 'react-native'

import { colors } from '@/ui/theme'

import type { PropsWithChildren } from 'react'

export function StatusCard({ children, title }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
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
    borderColor: colors.outline,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  row: {
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 4,
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
    fontSize: 18,
    fontWeight: '700',
  },
})
