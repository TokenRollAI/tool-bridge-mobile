import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { EmptyState } from '@/ui/components/EmptyState'
import { Screen } from '@/ui/components/Screen'
import { SectionHeading } from '@/ui/components/SectionHeading'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { CapabilitySnapshot } from '@/capabilities/types'

export function CapabilitiesScreen({
  capabilities,
  focused = true,
  onBack,
}: Readonly<{ capabilities: readonly CapabilitySnapshot[]; focused?: boolean; onBack?: (() => void) | undefined }>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
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
      onBack={onBack}
      title="能力"
    >
      <View style={styles.summary}>
        <View style={styles.summaryMetric}>
          <Text style={styles.metric}>{capabilities.filter(item => item.availability.status === 'available').length}</Text>
          <Text style={styles.metricLabel}>当前可用</Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={styles.metric}>{capabilities.length}</Text>
          <Text style={styles.metricLabel}>已探测能力</Text>
        </View>
      </View>
      <SectionHeading title="能力清单" detail="以设备实际探测为准" />
      {capabilities.map(({ availability, descriptor }) => {
        const capability = `${descriptor.path}.${descriptor.tool}`
        const available = availability.status === 'available'
        return (
          <StatusCard icon={available ? 'positive' : 'warning'} key={capability} title={capability}>
            <Text style={[styles.availabilityBadge, { color: available ? colors.success : colors.warning, backgroundColor: available ? colors.successSoft : colors.warningSoft }]}>{available ? '可用' : availability.status === 'permission_required' ? '需要授权' : '暂不可用'}</Text>
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
        <EmptyState icon="capabilities" title="运行时尚未完成能力探测。" description="完成探测后，这里会展示本机支持的能力和授权状态。" />
      ) : null}
    </Screen>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  summary: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.xl },
  summaryMetric: { flex: 1, gap: spacing.xs },
  metric: { color: colors.primary, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { color: colors.muted, fontSize: 13 },
  availabilityBadge: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, fontSize: 12, fontWeight: '600' },
  description: {
    color: colors.text,
    lineHeight: 20,
  },
})
