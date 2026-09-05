import { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { Icon } from '@/ui/components/Icon'
import { SafeMarkdown } from '@/ui/components/SafeMarkdown'
import { Screen } from '@/ui/components/Screen'
import {
  CATEGORY_LABEL,
  URGENCY_LABEL,
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/ui/inboxFormat'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'
import type { InboxLinkOpener } from '@/inbox/linkOpener'
import type { InboxMessage } from '@/inbox/types'

type InboxMessageScreenProps = Readonly<{
  focused?: boolean
  message: InboxMessage | null
  now?: Date
  onBack(): void
  onMarkRead(messageId: string): Promise<void>
  onOpenLink(rawUrl: string): Promise<void>
  onResolveImage(rawUrl: string, signal: AbortSignal): Promise<ResolvedInboxImage>
}>

export function InboxMessageScreen({
  focused = true,
  message,
  now,
  onBack,
  onMarkRead,
  onOpenLink,
  onResolveImage,
}: InboxMessageScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const imageResolver = useMemo<InboxImageSourceResolver>(() => ({
    resolve: onResolveImage,
  }), [onResolveImage])
  const linkOpener = useMemo<InboxLinkOpener>(() => ({
    open: onOpenLink,
  }), [onOpenLink])

  // 打开详情即视为已读；只对仍未读的消息触发一次，避免重复写入。
  const markedRef = useRef<string | null>(null)
  const messageId = message?.messageId ?? null
  const isUnread = message?.readAt === null
  useEffect(() => {
    if (messageId === null || !isUnread) return
    if (markedRef.current === messageId) return
    markedRef.current = messageId
    void onMarkRead(messageId)
  }, [isUnread, messageId, onMarkRead])

  useDiscreteAccessibilityAnnouncement(
    message === null ? 'inbox-message:missing' : `inbox-message:${message.messageId}`,
    message === null ? '未找到该信箱消息' : null,
  )

  if (message === null) {
    return (
      <Screen focused={focused} onBack={onBack} title="消息不存在">
        <View style={styles.emptyCard}>
          <Icon color={colors.muted} name="inbox" size={28} />
          <Text style={styles.empty}>这条本机信箱消息可能已被清空或不存在。</Text>
        </View>
      </Screen>
    )
  }

  const caller = message.callerDisplayName ?? message.callerSubjectId
  const relative = formatRelativeTime(message.receivedAt, now)
  return (
    <Screen
      backLabel="信箱"
      eyebrow={CATEGORY_LABEL[message.category]}
      focused={focused}
      onBack={onBack}
      title={message.title}
    >
      <View style={styles.metaBlock}>
        <View style={styles.metaLine}>
          {message.urgency === 'critical' || message.urgency === 'high' ? (
            <View
              style={[
                styles.urgencyTag,
                message.urgency === 'critical' ? styles.urgencyCritical : styles.urgencyHigh,
              ]}
            >
              <Text style={[styles.urgencyText, { color: message.urgency === 'critical' ? colors.danger : colors.warning }]}>{URGENCY_LABEL[message.urgency]}</Text>
            </View>
          ) : null}
          <Text style={styles.caller} numberOfLines={1}>{caller}</Text>
        </View>
        <Text
          accessibilityLabel={`收到时间：${formatAbsoluteTime(message.receivedAt)}`}
          style={styles.time}
        >
          {relative} · {formatAbsoluteTime(message.receivedAt)}
        </Text>
        {message.sourceLabel === null ? null : (
          <Text style={styles.source}>内容来源（Agent 提供）：{message.sourceLabel}</Text>
        )}
      </View>

      <View style={styles.divider} />

      <View style={styles.readingCard}>
        <SafeMarkdown imageResolver={imageResolver} linkOpener={linkOpener} markdown={message.body} />
      </View>
    </Screen>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  readingCard: { backgroundColor: colors.panel, padding: spacing.xl, borderRadius: radius.lg, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
  caller: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
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
  metaBlock: {
    gap: spacing.sm,
  },
  metaLine: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  source: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  time: {
    color: colors.muted,
    fontSize: 14,
  },
  urgencyCritical: {
    backgroundColor: colors.dangerSoft,
  },
  urgencyHigh: {
    backgroundColor: colors.warningSoft,
  },
  urgencyTag: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  urgencyText: {
    color: colors.onDanger,
    fontSize: 12,
    fontWeight: '800',
  },
})
