import { useEffect, useRef } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement, useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { radius, spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

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
  const styles = useThemedStyles(createStyles)
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
            <View style={styles.requestHeader}>
              <View accessibilityElementsHidden importantForAccessibility="no" style={styles.signal} />
              <Text accessibilityRole="header" ref={headingRef} style={styles.heading}>
                等待本地确认
              </Text>
            </View>
            <Text style={styles.queueSummary}>
              {confirmations.length === 1
                ? '1 条命令等待处理'
                : `${confirmations.length} 条命令等待处理；当前显示最早的一条`}
            </Text>
            <View style={styles.requestDetails}>
              <StatusRow label="调用方" value={caller} />
              <StatusRow label="能力" value={capability} />
              <StatusRow
                label="风险 / effect"
                value={`${confirmation.risk} / ${confirmation.effect}`}
              />
              <StatusRow label="确认截止" value={confirmation.expiresAt} />
            </View>
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
                icon="close"
                label={`拒绝 ${caller} 调用 ${capability}`}
                onPress={() => onReject(confirmation.commandId)}
                style={styles.action}
                variant="secondary"
                visualLabel="拒绝"
              />
              <AccessibleAction
                accessibilityHint="只允许当前命令一次，执行前仍会重新检查设备状态"
                icon="positive"
                label={`允许 ${caller} 调用 ${capability} 一次`}
                onPress={() => onApprove(confirmation.commandId)}
                style={styles.action}
                variant="primary"
                visualLabel="允许一次"
              />
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  requestHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  signal: { backgroundColor: colors.signal, borderRadius: radius.pill, height: 8, width: 8 },
  requestDetails: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  action: {
    flexBasis: 120,
    flexGrow: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  description: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  dialog: {
    backgroundColor: colors.slab,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 560,
    overflow: 'hidden',
    width: '100%',
  },
  footnote: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: colors.muted,
    paddingTop: spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  heading: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  queueSummary: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
})
