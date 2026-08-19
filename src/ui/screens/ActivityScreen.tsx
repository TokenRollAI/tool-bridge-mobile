import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors } from '@/ui/theme'

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
      {records.map(record => (
        <StatusCard key={record.id} title={`${record.path}.${record.tool}`}>
          <StatusRow label="来源" value={record.callerSubjectId} />
          <StatusRow label="时间" value={record.occurredAt} />
          <StatusRow label="影响" value={record.effect} />
          <StatusRow label="风险" value={record.risk} />
          <StatusRow label="决策" value={record.decision} />
          <StatusRow label="结果" value={record.outcomeCode} />
        </StatusCard>
      ))}
      {records.length === 0 ? <Text style={styles.empty}>暂无远程调用记录。</Text> : null}

      {!confirmingClear ? (
        <AccessibleAction
          accessibilityHint="先显示不可恢复操作的范围确认，不会立即删除"
          label="清除本机活动历史"
          onPress={() => {
            setFeedback(null)
            setConfirmingClear(true)
          }}
          ref={clearTriggerRef}
          style={styles.clearButton}
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
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              visualLabel="取消"
            />
            <AccessibleAction
              accessibilityHint="不可恢复地删除当前本机活动审计"
              busy={isClearing}
              label="确认清除活动历史"
              onPress={() => { void confirmClear() }}
              style={[styles.clearButton, isClearing ? styles.disabledButton : null]}
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
    gap: 12,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  clearButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    flex: 1,
  },
  confirmation: {
    backgroundColor: colors.panel,
    borderColor: colors.danger,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  confirmationTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.5,
  },
  empty: {
    color: colors.muted,
  },
  feedback: {
    color: colors.warning,
    fontSize: 14,
  },
  secondaryButton: {
    borderColor: colors.outline,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
  },
  secondaryButtonText: {
    color: colors.text,
  },
})
