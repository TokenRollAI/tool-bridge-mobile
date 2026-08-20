import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { CapabilitySnapshot } from '@/capabilities/types'

export function CapabilitiesScreen({
  capabilities,
  focused = true,
}: Readonly<{ capabilities: readonly CapabilitySnapshot[]; focused?: boolean }>) {
  const availabilityKey = capabilities.map(({ availability, descriptor }) => (
    `${descriptor.path}.${descriptor.tool}:${availability.status}:${'reason' in availability
      ? availability.reason
      : ''}`
  )).sort().join(',')
  useDiscreteAccessibilityAnnouncement(
    `capabilities:${availabilityKey}`,
    '设备能力可用性已更新',
  )

  return (
    <Screen
      description="能力来自实际 probe；未注册的硬件能力不会出现在此处。"
      focused={focused}
      title="能力"
    >
      {capabilities.map(({ availability, descriptor }) => {
        const capability = `${descriptor.path}.${descriptor.tool}`
        const available = availability.status === 'available'
        return (
          <StatusCard icon={available ? 'positive' : 'warning'} key={capability} title={capability}>
            <Text style={styles.description}>{descriptor.description}</Text>
            <StatusRow
              label="effect / risk"
              value={`${descriptor.effect} / ${descriptor.risk}`}
            />
            <StatusRow label="确认" value={descriptor.confirmation} />
            <StatusRow
              label="availability"
              value={available
                ? 'available'
                : `${availability.status}: ${availability.reason}`}
            />
          </StatusCard>
        )
      })}
      {capabilities.length === 0 ? (
        <View style={styles.emptyCard}>
          <Icon color={colors.warning} name="warning" size={28} />
          <Text style={styles.empty}>运行时尚未完成能力探测。</Text>
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  description: {
    color: colors.text,
    lineHeight: 20,
  },
  empty: {
    color: colors.warning,
    fontSize: 15,
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
})
