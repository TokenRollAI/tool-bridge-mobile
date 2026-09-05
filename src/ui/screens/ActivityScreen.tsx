import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { EmptyState } from '@/ui/components/EmptyState'
import { Screen } from '@/ui/components/Screen'
import { SectionHeading } from '@/ui/components/SectionHeading'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { radius, spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { AuditRecord } from '@/audit/types'
import type { Pressable, Text as NativeText } from 'react-native'

type ActivityScreenProps = Readonly<{
  focused?: boolean
  onBack?: (() => void) | undefined
  onClearAuditHistory: () => Promise<number>
  records: readonly AuditRecord[]
}>

export function ActivityScreen({
  focused = true,
  onBack,
  onClearAuditHistory,
  records,
}: ActivityScreenProps) {
  const styles = useThemedStyles(createStyles)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const clearTriggerRef = useRef<React.ElementRef<typeof Pressable>>(null)
  const confirmationTitleRef = useRef<NativeText>(null)
  const wasConfirming = useRef(false)

  useEffect(() => {
    if (confirmingClear && !wasConfirming.current) {
      void focusAccessibilityElement(confirmationTitleRef.current)
    } else if (!confirmingClear && wasConfirming.current) {
      void focusAccessibilityElement(clearTriggerRef.current)
    }
    wasConfirming.current = confirmingClear
  }, [confirmingClear])
  useDiscreteAccessibilityAnnouncement(
    feedback === null ? null : `activity-feedback:${feedback}`,
    feedback,
    feedback?.startsWith('清除失败') === true ? 'assertive' : 'polite',
  )

  const confirmClear = async () => {
    if (isClearing) return
    setIsClearing(true)
    setFeedback(null)
    try {
      const deleted = await onClearAuditHistory()
      setConfirmingClear(false)
      setFeedback(`已清除 ${deleted} 条本机活动历史；后续调用会继续记录。`)
    } catch {
      setFeedback('清除失败；本机活动历史未被确认删除。')
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Screen
      backLabel="设备"
      onBack={onBack}
      description="每一次调用，都有迹可循。这里只显示调用元数据。"
      focused={focused}
      title="活动"
    >
      <SectionHeading title="调用记录" detail={`最近 ${records.length} 条`} />
      {records.length === 0 ? (
        <EmptyState icon="activity" title="暂无远程调用记录。" description="Agent 调用这台设备后，可在这里查看本地决策和执行结果。" />
      ) : (
        <View style={styles.timeline}>
          {records.map(record => (
            <StatusCard icon="activity" key={record.id} title={`${record.path}.${record.tool}`}>
              <Text accessibilityLabel={`时间：${record.occurredAt}`} style={styles.timestamp}>{record.occurredAt}</Text>
              <StatusRow label="来源" value={record.callerSubjectId} />
              <View style={styles.resultBlock}>
                <StatusRow label="决策" value={record.decision} />
                <StatusRow label="结果" value={record.outcomeCode} />
              </View>
              <View style={styles.boundaries}>
                <StatusRow label="影响" value={record.effect} />
                <StatusRow label="风险" value={record.risk} />
              </View>
              <Text style={styles.timeHint}>决策允许不代表执行成功，请以结果为准。</Text>
            </StatusCard>
          ))}
        </View>
      )}
      <Text style={styles.timeHint}>显示最近 100 条，本机最多保留 5,000 条；不展示参数、正文或结果载荷。</Text>

      {!confirmingClear ? (
        <AccessibleAction
          accessibilityHint="先显示不可恢复操作的范围确认，不会立即删除"
          icon="trash"
          label="清除本机活动历史"
          onPress={() => {
            setFeedback(null)
            setConfirmingClear(true)
          }}
          ref={clearTriggerRef}
          variant="secondary"
        />
      ) : (
        <View style={styles.confirmation}>
          <Text
            accessibilityRole="header"
            ref={confirmationTitleRef}
            style={styles.confirmationTitle}
          >
            确认清除当前活动历史？
          </Text>
          <Text style={styles.body}>
            此操作不可恢复，只删除本机活动审计。它不会取消命令，也不会清除防重放记录、计时器、设置、installation identity 或凭证；后续调用仍会继续记录。
          </Text>
          <View style={styles.actionRow}>
            <AccessibleAction
              busy={isClearing}
              label="取消清除活动历史"
              onPress={() => {
                setConfirmingClear(false)
                setFeedback(null)
              }}
              style={styles.flexButton}
              variant="secondary"
              visualLabel="取消"
            />
            <AccessibleAction
              accessibilityHint="不可恢复地删除当前本机活动审计"
              busy={isClearing}
              icon="trash"
              label="确认清除活动历史"
              onPress={() => { void confirmClear() }}
              style={styles.flexButton}
              variant="danger"
              visualLabel={isClearing ? '正在清除…' : '确认清除'}
            />
          </View>
        </View>
      )}
      {feedback === null ? null : <Text style={styles.feedback}>{feedback}</Text>}
    </Screen>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  timeline: { gap: spacing.md },
  timestamp: { color: colors.muted, fontSize: 12 },
  resultBlock: { backgroundColor: colors.panelElevated, borderRadius: radius.sm, padding: spacing.md, gap: spacing.sm },
  boundaries: { gap: spacing.xs },
  timeHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  confirmation: {
    backgroundColor: colors.panel,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  confirmationTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  feedback: {
    backgroundColor: colors.panel,
    borderColor: colors.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  flexButton: {
    flexBasis: 120,
    flexGrow: 1,
  },
})
