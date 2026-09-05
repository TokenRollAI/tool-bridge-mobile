import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { EmptyState } from '@/ui/components/EmptyState'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { SectionHeading } from '@/ui/components/SectionHeading'
import {
  URGENCY_LABEL,
  formatRelativeTime,
  markdownSummary,
} from '@/ui/inboxFormat'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type {
  InboxMessage,
  InboxSort,
  InboxViewOptions,
} from '@/inbox/types'
import type { Pressable as PressableType, Text as NativeText } from 'react-native'

const SORT_OPTIONS: readonly Readonly<{ label: string; value: InboxSort }>[] = [
  { label: '最新', value: 'received_desc' },
  { label: '最早', value: 'received_asc' },
  { label: '未读优先', value: 'unread_first' },
]

type InboxScreenProps = Readonly<{
  focused?: boolean
  messages: readonly InboxMessage[]
  now?: Date
  onClearInbox(): Promise<number>
  onMarkAllRead(): Promise<number>
  onOpenMessage(messageId: string): void
  onViewOptionsChange(options: InboxViewOptions): Promise<void>
  unreadCount: number
  viewOptions: InboxViewOptions
}>

function MessageListItem({
  message,
  now,
  onOpen,
}: Readonly<{ message: InboxMessage; now?: Date | undefined; onOpen(): void }>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const caller = message.callerDisplayName ?? message.callerSubjectId
  const unread = message.readAt === null
  const relative = formatRelativeTime(message.receivedAt, now)
  const summary = markdownSummary(message.body)
  const showUrgency = message.urgency === 'critical' || message.urgency === 'high'
  const accessibilityLabel = [
    unread ? '未读' : '已读',
    showUrgency ? URGENCY_LABEL[message.urgency] : null,
    message.title,
    `来自 ${caller}`,
    relative,
  ].filter(Boolean).join('，')
  return (
    <Pressable
      accessibilityHint="打开这条本机信箱消息查看完整内容"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.avatar}>
        <Text style={styles.avatarText}>{caller.slice(0, 1).toLocaleUpperCase()}</Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.itemBody}
      >
        <View style={styles.itemHeader}>
          <View
            style={[styles.unreadDot, unread ? styles.unreadDotActive : null]}
          />
          <Text numberOfLines={1} style={[styles.itemTitle, unread ? styles.itemTitleUnread : null]}>
            {message.title}
          </Text>
        </View>
        <View style={styles.itemMetaLine}>
          {showUrgency ? (
            <Text
              style={[
                styles.urgencyTag,
                message.urgency === 'critical' ? styles.urgencyCritical : styles.urgencyHigh,
              ]}
            >
              {URGENCY_LABEL[message.urgency]}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={styles.itemCaller}>{caller}</Text>
          <Text numberOfLines={1} style={styles.itemTime}>{relative}</Text>
        </View>
        {summary === '' ? null : (
          <Text numberOfLines={2} style={styles.itemSummary}>{summary}</Text>
        )}
      </View>
      <Icon color={colors.muted} name="chevron" size={18} />
    </Pressable>
  )
}

export function InboxScreen({
  focused = true,
  messages,
  now,
  onClearInbox,
  onMarkAllRead,
  onOpenMessage,
  onViewOptionsChange,
  unreadCount,
  viewOptions,
}: InboxScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const [isMarkingAll, setIsMarkingAll] = useState(false)
  const [isUpdatingView, setIsUpdatingView] = useState(false)
  const [searchText, setSearchText] = useState(viewOptions.searchQuery)
  const clearTriggerRef = useRef<React.ElementRef<typeof PressableType>>(null)
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
    `inbox-unread:${unreadCount}`,
    `信箱未读数量已变为 ${unreadCount}`,
  )
  useDiscreteAccessibilityAnnouncement(
    feedback === null ? null : `inbox-feedback:${feedback}`,
    feedback,
    feedback?.includes('失败') === true ? 'assertive' : 'polite',
  )

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
      setFeedback(`已清空 ${deleted} 条本机信箱消息。`)
    } catch {
      setFeedback('清空失败；本机信箱消息未被确认删除。')
    } finally {
      setIsClearing(false)
    }
  }

  const searching = viewOptions.searchQuery !== ''

  return (
    <Screen
      description="来自 Agent 的消息，集中留在本机。"
      eyebrow="TOOL BRIDGE"
      focused={focused}
      title="信箱"
    >
      <View style={styles.searchBar}>
        <Icon color={colors.muted} name="search" size={18} />
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
        {searchText === '' ? null : (
          <Pressable
            accessibilityLabel="清除信箱搜索词"
            accessibilityRole="button"
            style={styles.clearSearch}
            onPress={() => {
              setSearchText('')
              void applySearch('')
            }}
          >
            <Icon color={colors.muted} name="danger" size={18} />
          </Pressable>
        )}
      </View>

      <View accessibilityRole="radiogroup" style={styles.sortRow}>
        {SORT_OPTIONS.map(option => {
          const selected = option.value === viewOptions.sort
          return (
            <Pressable
              accessibilityLabel={`信箱排序：${option.label}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              disabled={isUpdatingView}
              key={option.value}
              onPress={() => { void changeSort(option.value) }}
              style={[styles.sortChip, selected ? styles.sortChipSelected : null]}
            >
              <Text style={[styles.sortChipText, selected ? styles.sortChipTextSelected : null]}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
        <View style={styles.sortSpacer} />
        {unreadCount === 0 ? null : (
          <Pressable
            accessibilityLabel="将本机信箱全部标为已读"
            accessibilityRole="button"
            accessibilityState={{ busy: isMarkingAll }}
            disabled={isMarkingAll}
            onPress={() => { void markAllRead() }}
            style={styles.markAllButton}
          >
            <Text style={styles.markAllText}>
              {isMarkingAll ? '标记中…' : '全部已读'}
            </Text>
          </Pressable>
        )}
      </View>

      <SectionHeading title={searching ? '搜索结果' : '最近消息'} detail={unreadCount > 0 ? `${unreadCount} 条未读` : '全部已读'} />
      {messages.length === 0 ? (
        <EmptyState icon="inbox" title={searching ? '没有匹配的本机信箱消息。' : '最近还没有 Agent 来信。'} description={searching ? '试试其他关键词，或清除搜索查看全部消息。' : '收到消息后会显示在这里。点开即可阅读并标为已读。'} />
      ) : (
        <View style={styles.list}>
          {messages.map(message => (
            <MessageListItem
              key={message.messageId}
              message={message}
              now={now}
              onOpen={() => { onOpenMessage(message.messageId) }}
            />
          ))}
        </View>
      )}

      {feedback === null ? null : <Text style={styles.feedback}>{feedback}</Text>}

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
          variant="secondary"
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
          <Text style={styles.confirmationBody}>
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
    </Screen>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  confirmation: {
    backgroundColor: colors.panel,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  confirmationBody: { color: colors.text, fontSize: 15, lineHeight: 22 },
  confirmationTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
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
  avatar: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primarySoft },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.primary },
  clearSearch: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  item: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.md,
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  itemBody: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
  },
  itemCaller: {
    color: colors.muted,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 13,
  },
  itemHeader: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  itemMetaLine: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  itemPressed: {
    opacity: 0.7,
  },
  itemSummary: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  itemTime: {
    color: colors.muted,
    flexShrink: 0,
    fontSize: 12,
  },
  itemTitle: {
    color: colors.text,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  itemTitleUnread: {
    fontWeight: '800',
  },
  list: { backgroundColor: colors.panel, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  markAllButton: {
    alignItems: 'center',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  markAllText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: colors.panelElevated,
    borderColor: colors.outline,
    borderRadius: radius.md,
    borderWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    color: colors.text,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 16,
    minHeight: 48,
    paddingVertical: spacing.md,
  },
  sortChip: {
    alignItems: 'center',
    borderColor: colors.outline,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  sortChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  sortChipTextSelected: {
    color: colors.onPrimary,
  },
  sortRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  sortSpacer: {
    flexGrow: 1,
  },
  unreadDot: {
    backgroundColor: 'transparent',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  unreadDotActive: {
    backgroundColor: colors.primary,
  },
  urgencyCritical: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  urgencyHigh: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
  urgencyTag: {
    borderRadius: radius.sm,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
})
