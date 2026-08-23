import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Icon } from '@/ui/components/Icon'
import { SafeMarkdown } from '@/ui/components/SafeMarkdown'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'
import type {
  InboxMessage,
  InboxMessageCategory,
  InboxMessageUrgency,
  InboxSort,
  InboxViewOptions,
} from '@/inbox/types'
import type { Pressable, Text as NativeText } from 'react-native'

const HALF_HOUR_MS = 30 * 60 * 1_000

const CATEGORY_LABEL: Readonly<Record<InboxMessageCategory, string>> = {
  message: '消息',
  news: '新闻',
  subscription: '订阅',
  update: '更新',
}

const URGENCY_LABEL: Readonly<Record<InboxMessageUrgency, string>> = {
  critical: '紧急',
  high: '高',
  low: '低',
  normal: '普通',
}

const SORT_OPTIONS: readonly Readonly<{ label: string; value: InboxSort }>[] = [
  { label: '收件：新到旧', value: 'received_desc' },
  { label: '收件：旧到新', value: 'received_asc' },
  { label: '发送：新到旧', value: 'sent_desc' },
  { label: '发送：旧到新', value: 'sent_asc' },
  { label: '未读优先', value: 'unread_first' },
  { label: '已读优先', value: 'read_first' },
]

type InboxScreenProps = Readonly<{
  focused?: boolean
  messages: readonly InboxMessage[]
  now?: Date
  onClearInbox(): Promise<number>
  onMarkAllRead(): Promise<number>
  onMarkRead(messageId: string): Promise<void>
  onResolveImage(rawUrl: string, signal: AbortSignal): Promise<ResolvedInboxImage>
  onViewOptionsChange(options: InboxViewOptions): Promise<void>
  unreadCount: number
  viewOptions: InboxViewOptions
}>

export function InboxScreen({
  focused = true,
  messages,
  now,
  onClearInbox,
  onMarkAllRead,
  onMarkRead,
  onResolveImage,
  onViewOptionsChange,
  unreadCount,
  viewOptions,
}: InboxScreenProps) {
  const [liveClockMs, setLiveClockMs] = useState(() => Date.now())
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const [isMarkingAll, setIsMarkingAll] = useState(false)
  const [isUpdatingView, setIsUpdatingView] = useState(false)
  const [markingMessageId, setMarkingMessageId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState(viewOptions.searchQuery)
  const clearTriggerRef = useRef<React.ElementRef<typeof Pressable>>(null)
  const confirmationTitleRef = useRef<NativeText>(null)
  const wasConfirming = useRef(false)
  const imageResolver = useMemo<InboxImageSourceResolver>(() => ({
    resolve: onResolveImage,
  }), [onResolveImage])

  useEffect(() => {
    if (now !== undefined) return undefined
    const interval = setInterval(() => { setLiveClockMs(Date.now()) }, 60_000)
    return () => { clearInterval(interval) }
  }, [now])

  useEffect(() => {
    if (confirmingClear && !wasConfirming.current) {
      void focusAccessibilityElement(confirmationTitleRef.current)
    } else if (!confirmingClear && wasConfirming.current) {
      void focusAccessibilityElement(clearTriggerRef.current)
    }
    wasConfirming.current = confirmingClear
  }, [confirmingClear])

  useDiscreteAccessibilityAnnouncement(
    `inbox-unread:${unreadCount}`,
    `信箱未读数量已变为 ${unreadCount}`,
  )
  useDiscreteAccessibilityAnnouncement(
    feedback === null ? null : `inbox-feedback:${feedback}`,
    feedback,
    feedback?.includes('失败') === true ? 'assertive' : 'polite',
  )

  const cutoffMs = (now?.getTime() ?? liveClockMs) - HALF_HOUR_MS
  const recentCount = messages.filter(message => Date.parse(message.receivedAt) >= cutoffMs).length

  const markRead = async (messageId: string) => {
    if (markingMessageId !== null) return
    setMarkingMessageId(messageId)
    setFeedback(null)
    try {
      await onMarkRead(messageId)
      setFeedback('消息已标为已读。')
    } catch {
      setFeedback('标记已读失败；消息状态未被确认更改。')
    } finally {
      setMarkingMessageId(null)
    }
  }

  const markAllRead = async () => {
    if (isMarkingAll || unreadCount === 0) return
    setIsMarkingAll(true)
    setFeedback(null)
    try {
      const changed = await onMarkAllRead()
      setFeedback(`已将 ${changed} 条本机信箱消息标为已读。`)
    } catch {
      setFeedback('全部标为已读失败；消息状态未被确认更改。')
    } finally {
      setIsMarkingAll(false)
    }
  }

  const changeSort = async (sort: InboxSort) => {
    if (isUpdatingView || sort === viewOptions.sort) return
    setIsUpdatingView(true)
    setFeedback(null)
    try {
      await onViewOptionsChange({ searchQuery: searchText, sort })
    } catch {
      setFeedback('排序失败；当前结果顺序未被确认更改。')
    } finally {
      setIsUpdatingView(false)
    }
  }

  const applySearch = async (query: string) => {
    if (isUpdatingView || query.trim() === viewOptions.searchQuery) return
    setIsUpdatingView(true)
    setFeedback(null)
    try {
      await onViewOptionsChange({ searchQuery: query, sort: viewOptions.sort })
    } catch {
      setFeedback('搜索失败；当前结果可能仍是上一次查询。')
    } finally {
      setIsUpdatingView(false)
    }
  }

  const clearInbox = async () => {
    if (isClearing) return
    setIsClearing(true)
    setFeedback(null)
    try {
      const deleted = await onClearInbox()
      setConfirmingClear(false)
      setExpandedMessageId(null)
      setFeedback(`已清空 ${deleted} 条本机信箱消息。`)
    } catch {
      setFeedback('清空失败；本机信箱消息未被确认删除。')
    } finally {
      setIsClearing(false)
    }
  }

  const renderMessage = (message: InboxMessage) => {
    const caller = message.callerDisplayName ?? message.callerSubjectId
    const expanded = expandedMessageId === message.messageId
    const urgency = URGENCY_LABEL[message.urgency]
    return (
      <StatusCard
        icon={message.readAt === null ? 'inboxUnread' : 'inbox'}
        key={message.messageId}
        title={`${message.readAt === null ? '未读 · ' : ''}${urgency} · ${message.title}`}
        tone={message.urgency === 'critical' ? 'danger' : 'neutral'}
      >
        <StatusRow label="调用方" value={caller} />
        <StatusRow label="类型" value={CATEGORY_LABEL[message.category]} />
        <StatusRow label="紧急程度" value={urgency} />
        {message.sourceLabel === null ? null : (
          <StatusRow label="内容来源（Agent 提供）" value={message.sourceLabel} />
        )}
        {message.sentAt === null ? null : (
          <StatusRow label="发送时间（Agent 提供）" value={message.sentAt} />
        )}
        <StatusRow label="收到时间" value={message.receivedAt} />
        {!expanded ? <Text numberOfLines={3} style={styles.body}>{markdownSummary(message.body)}</Text> : (
          <SafeMarkdown imageResolver={imageResolver} markdown={message.body} />
        )}
        <View style={styles.actionRow}>
          <AccessibleAction
            label={`${expanded ? '收起' : '查看'} ${caller} 于 ${message.receivedAt} 的信箱消息内容`}
            onPress={() => { setExpandedMessageId(expanded ? null : message.messageId) }}
            style={styles.flexButton}
            variant="secondary"
            visualLabel={expanded ? '收起内容' : '查看 Markdown'}
          />
          {message.readAt === null ? (
            <AccessibleAction
              busy={markingMessageId === message.messageId}
              label={`将 ${caller} 于 ${message.receivedAt} 的信箱消息标为已读`}
              onPress={() => { void markRead(message.messageId) }}
              style={styles.flexButton}
              variant="secondary"
              visualLabel={markingMessageId === message.messageId ? '正在标记…' : '标为已读'}
            />
          ) : null}
        </View>
        {message.readAt === null ? null : <StatusRow label="已读时间" value={message.readAt} />}
      </StatusCard>
    )
  }

  return (
    <Screen
      description="Agent 通过当前设备直连会话投递后，Markdown 消息只保存在本机；搜索覆盖最多保留的 1,000 条，当前结果最多展示 100 条。离线队列与 push 尚未实现。"
      focused={focused}
      title="信箱"
    >
      <StatusCard icon="inbox" title="信箱概览">
        <StatusRow label="当前结果" value={`${messages.length} 条`} />
        <StatusRow label="结果中最近半小时" value={`${recentCount} 条`} />
        <StatusRow label="全部未读" value={`${unreadCount} 条`} />
        <Text style={styles.note}>
          紧急程度、内容来源和发送时间由 Agent 提供，只是内容元数据；调用方与本机收到时间来自 Tool Bridge 执行上下文和本机存储。
        </Text>
      </StatusCard>

      <StatusCard icon="search" title="搜索与排序">
        <TextInput
          accessibilityLabel="搜索本机信箱"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={120}
          onChangeText={setSearchText}
          onSubmitEditing={() => { void applySearch(searchText) }}
          placeholder="搜索标题、正文、来源或调用方"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        <View style={styles.actionRow}>
          <AccessibleAction
            busy={isUpdatingView}
            disabled={searchText.trim() === viewOptions.searchQuery}
            label="执行本机信箱搜索"
            onPress={() => { void applySearch(searchText) }}
            style={styles.flexButton}
            variant="secondary"
            visualLabel="搜索"
          />
          {searchText === '' && viewOptions.searchQuery === '' ? null : (
            <AccessibleAction
              disabled={isUpdatingView}
              label="清除信箱搜索词"
              onPress={() => {
                setSearchText('')
                void applySearch('')
              }}
              style={styles.flexButton}
              variant="secondary"
              visualLabel="清除搜索"
            />
          )}
        </View>
        <View accessibilityRole="radiogroup" style={styles.sortOptions}>
          {SORT_OPTIONS.map(option => (
            <AccessibleAction
              busy={isUpdatingView && option.value === viewOptions.sort}
              key={option.value}
              label={`信箱排序：${option.label}`}
              onPress={() => { void changeSort(option.value) }}
              role="radio"
              selected={option.value === viewOptions.sort}
              style={styles.sortButton}
              variant="secondary"
              visualLabel={option.label}
            />
          ))}
        </View>
      </StatusCard>

      <AccessibleAction
        busy={isMarkingAll}
        disabled={unreadCount === 0}
        label="将本机信箱全部标为已读"
        onPress={() => { void markAllRead() }}
        variant="secondary"
        visualLabel={isMarkingAll ? '正在全部标记…' : '全部标为已读'}
      />

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {viewOptions.searchQuery === '' ? '信箱消息' : '搜索结果'}
      </Text>
      {messages.length === 0 ? (
        <View style={styles.emptyCard}>
          <Icon color={colors.muted} name="inbox" size={28} />
          <Text style={styles.empty}>
            {viewOptions.searchQuery === '' ? '最近还没有 Agent 来信。' : '没有匹配的本机信箱消息。'}
          </Text>
        </View>
      ) : messages.map(renderMessage)}

      {!confirmingClear ? (
        <AccessibleAction
          accessibilityHint="先显示只删除本机信箱内容的范围确认，不会立即删除"
          icon="trash"
          label="清空本机信箱"
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
            确认清空本机信箱？
          </Text>
          <Text style={styles.body}>
            此操作不可恢复，只删除本机信箱消息。它不会删除 command 防重放记录、活动审计、设置或凭证；同一 commandId 重放也不会重建已清空的消息。
          </Text>
          <View style={styles.actionRow}>
            <AccessibleAction
              busy={isClearing}
              label="取消清空本机信箱"
              onPress={() => {
                setConfirmingClear(false)
                setFeedback(null)
              }}
              style={styles.flexButton}
              variant="secondary"
              visualLabel="取消"
            />
            <AccessibleAction
              accessibilityHint="不可恢复地删除当前本机信箱内容"
              busy={isClearing}
              icon="trash"
              label="确认清空本机信箱"
              onPress={() => { void clearInbox() }}
              style={styles.flexButton}
              variant="danger"
              visualLabel={isClearing ? '正在清空…' : '确认清空'}
            />
          </View>
        </View>
      )}
      {feedback === null ? null : <Text style={styles.feedback}>{feedback}</Text>}
    </Screen>
  )
}

function markdownSummary(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '[图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^[#>\-*+\d.\s]+/gmu, '')
    .replace(/[*_~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  confirmation: {
    backgroundColor: colors.panel,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  confirmationTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center' },
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
  flexButton: { flexBasis: 140, flexGrow: 1 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  searchInput: {
    backgroundColor: colors.panelElevated,
    borderColor: colors.outline,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sortButton: { flexBasis: 132, flexGrow: 1, paddingHorizontal: spacing.sm },
  sortOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
