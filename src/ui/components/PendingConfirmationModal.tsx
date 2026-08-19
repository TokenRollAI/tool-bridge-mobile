import { useEffect, useRef } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement, useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { colors } from '@/ui/theme'

import { AccessibleAction } from './AccessibleAction'
import { StatusRow } from './StatusCard'

import type { PendingConfirmationSnapshot } from '@/policy/localConfirmationCoordinator'

type PendingConfirmationModalProps = Readonly<{
  confirmations: readonly PendingConfirmationSnapshot[]
  onApprove(commandId: string): void
  onReject(commandId: string): void
}>

export function PendingConfirmationModal({
  confirmations,
  onApprove,
  onReject,
}: PendingConfirmationModalProps) {
  const confirmation = confirmations[0] ?? null
  const headingRef = useRef<Text>(null)
  const commandId = confirmation?.commandId ?? null

  useEffect(() => {
    if (commandId !== null) void focusAccessibilityElement(headingRef.current)
  }, [commandId])

  useDiscreteAccessibilityAnnouncement(
    commandId === null ? 'confirmation:none' : `confirmation:${commandId}`,
    commandId === null
      ? '当前没有等待本地确认的命令'
      : `有 ${confirmations.length} 个命令等待本地确认`,
    'assertive',
  )

  if (confirmation === null) return null

  const caller = confirmation.callerDisplayName ?? confirmation.callerSubjectId
  const capability = `${confirmation.path}.${confirmation.tool}`

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={() => undefined}
      statusBarTranslucent
      transparent
      visible
    >
      <SafeAreaView style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={styles.dialog}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" ref={headingRef} style={styles.heading}>
              等待本地确认
            </Text>
            <Text style={styles.queueSummary}>
              {confirmations.length === 1
                ? '1 条命令等待处理'
                : `${confirmations.length} 条命令等待处理；当前显示最早的一条`}
            </Text>
            <StatusRow label="调用方" value={caller} />
            <StatusRow label="能力" value={capability} />
            <StatusRow
              label="风险 / effect"
              value={`${confirmation.risk} / ${confirmation.effect}`}
            />
            <StatusRow label="确认截止" value={confirmation.expiresAt} />
            <Text style={styles.description}>{confirmation.description}</Text>
            {confirmation.details.map(detail => (
              <StatusRow key={detail.label} label={detail.label} value={detail.value} />
            ))}
            <Text style={styles.footnote}>
              只裁决当前这一条命令。允许后仍会重新检查期限、权限与设备状态；完整参数不会写入普通审计日志。
            </Text>
            <View style={styles.actions}>
              <AccessibleAction
                accessibilityHint="拒绝当前命令，不影响队列中的其他命令"
                label={`拒绝 ${caller} 调用 ${capability}`}
                onPress={() => onReject(confirmation.commandId)}
                style={[styles.action, styles.rejectAction]}
                visualLabel="拒绝"
              />
              <AccessibleAction
                accessibilityHint="只允许当前命令一次，执行前仍会重新检查设备状态"
                label={`允许 ${caller} 调用 ${capability} 一次`}
                onPress={() => onApprove(confirmation.commandId)}
                style={[styles.action, styles.approveAction]}
                visualLabel="允许一次"
              />
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  action: {
    borderRadius: 14,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  approveAction: {
    backgroundColor: colors.primary,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    gap: 14,
    padding: 20,
  },
  description: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  dialog: {
    backgroundColor: colors.panel,
    borderColor: colors.outline,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 560,
    overflow: 'hidden',
    width: '100%',
  },
  footnote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  heading: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '800',
  },
  queueSummary: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  rejectAction: {
    backgroundColor: colors.danger,
  },
})
