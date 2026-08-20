import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { AuditRecord } from '@/audit/types'
import type { Pressable, Text as NativeText } from 'react-native'

type ActivityScreenProps = Readonly<{
  focused?: boolean
  onClearAuditHistory: () => Promise<number>
  records: readonly AuditRecord[]
}>

export function ActivityScreen({
  focused = true,
  onClearAuditHistory,
  records,
}: ActivityScreenProps) {
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
      description="这里只展示最近 100 条调用元数据；本机最多保留 5,000 条，不展示参数、正文或结果载荷。"
      focused={focused}
      title="活动"
    >
      {records.map(record => {
        const allowed = record.decision === 'allowed'
        return (
          <StatusCard
            icon={allowed ? 'positive' : 'danger'}
            key={record.id}
            title={`${record.path}.${record.tool}`}
          >
            <StatusRow label="来源" value={record.callerSubjectId} />
            <StatusRow label="时间" value={record.occurredAt} />
            <StatusRow label="影响" value={record.effect} />
            <StatusRow label="风险" value={record.risk} />
            <StatusRow label="决策" value={record.decision} />
            <StatusRow label="结果" value={record.outcomeCode} />
          </StatusCard>
        )
      })}
      {records.length === 0 ? (
        <View style={styles.emptyCard}>
          <Icon color={colors.muted} name="activity" size={28} />
          <Text style={styles.empty}>暂无远程调用记录。</Text>
        </View>
      ) : null}

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
          variant="danger"
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

const styles = StyleSheet.create({
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
  empty: {
    color: colors.muted,
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
