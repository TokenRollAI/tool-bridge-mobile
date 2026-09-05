import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import {
  focusAccessibilityElement,
  useDiscreteAccessibilityAnnouncement,
} from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { ActionSheet } from '@/ui/components/ActionSheet'
import { EmptyState } from '@/ui/components/EmptyState'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
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
  const styles = useThemedStyles(createStyles)
  const caller = message.callerDisplayName ?? message.callerSubjectId
  const unread = message.readAt === null
  const relative = formatRelativeTime(message.receivedAt, now)
  const summary = markdownSummary(message.body)
  const showUrgency = message.urgency === 'critical' || message.urgency === 'high'
  const accessibilityLabel = [
    unread ? '未读' : '已读',
    showUrgency ? URGENCY_LABEL[message.urgency] : null,
    message.title, `来自 ${caller}`, relative,
  ].filter(Boolean).join('，')
  return (
    <Pressable
      accessibilityHint="打开这条本机信箱消息查看完整内容"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.itemBody}>
        <View style={styles.itemMetaLine}>
          <View style={[styles.unreadDot, unread ? styles.unreadDotActive : null]} />
          <Text numberOfLines={1} style={[styles.itemCaller, unread ? styles.itemCallerUnread : null]}>{caller}</Text>
          <Text style={styles.itemTime}>{relative}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.itemTitle, unread ? styles.itemTitleUnread : null]}>{message.title}</Text>
        {summary === '' ? null : <Text numberOfLines={2} style={styles.itemSummary}>{summary}</Text>}
        {showUrgency ? <Text style={[styles.urgencyTag, message.urgency === 'critical' ? styles.urgencyCritical : styles.urgencyHigh]}>{URGENCY_LABEL[message.urgency]}优先级</Text> : null}
      </View>
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
  const [sheet, setSheet] = useState<'more' | 'sort' | null>(null)
  const unreadOnly = viewOptions.unreadOnly === true
  const moreTriggerRef = useRef<React.ElementRef<typeof PressableType>>(null)
  const sortTriggerRef = useRef<React.ElementRef<typeof PressableType>>(null)
  const previousSheet = useRef<typeof sheet>(null)
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

  useEffect(() => {
    if (sheet === null && previousSheet.current !== null) {
      void focusAccessibilityElement(previousSheet.current === 'sort' ? sortTriggerRef.current : moreTriggerRef.current)
    }
    previousSheet.current = sheet
  }, [sheet])

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
      await onViewOptionsChange({ searchQuery: searchText, sort, ...(unreadOnly ? { unreadOnly: true } : {}) })
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
      await onViewOptionsChange({ searchQuery: query, sort: viewOptions.sort, ...(unreadOnly ? { unreadOnly: true } : {}) })
    } catch {
      setFeedback('搜索失败；当前结果可能仍是上一次查询。')
    } finally {
      setIsUpdatingView(false)
    }
  }

  const changeUnreadFilter = async (onlyUnread: boolean) => {
    if (isUpdatingView || onlyUnread === unreadOnly) return
    setIsUpdatingView(true)
    setFeedback(null)
    try {
      await onViewOptionsChange({
        searchQuery: viewOptions.searchQuery,
        sort: viewOptions.sort,
        ...(onlyUnread ? { unreadOnly: true } : {}),
      })
    } catch {
      setFeedback('筛选失败；仍显示原来的消息范围。')
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
  const currentSort = SORT_OPTIONS.find(option => option.value === viewOptions.sort)?.label ?? '最新'
  const closeSheet = () => {
    if (isClearing || isMarkingAll || isUpdatingView) return
    setConfirmingClear(false)
    setSheet(null)
  }
  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.searchBar}>
        <Icon color={colors.muted} name="search" size={18} />
        <TextInput
          accessibilityLabel="搜索本机信箱"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isUpdatingView}
          maxLength={120}
          onChangeText={setSearchText}
          onSubmitEditing={() => { void applySearch(searchText) }}
          placeholder="搜索消息"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        {searchText === '' ? null : (
          <Pressable accessibilityLabel="清除信箱搜索词" accessibilityRole="button" accessibilityState={{ disabled: isUpdatingView, busy: isUpdatingView }} disabled={isUpdatingView} style={styles.iconButton} onPress={() => { setSearchText(''); void applySearch('') }}>
            <Icon color={colors.muted} name="close" size={18} />
          </Pressable>
        )}
      </View>
      <View style={styles.filterRow}>
        <View accessibilityRole="radiogroup" style={styles.filterTabs}>
          {[false, true].map(onlyUnread => (
            <Pressable
              accessibilityLabel={onlyUnread ? '只看未读消息' : '查看全部消息'}
              accessibilityRole="radio"
              accessibilityState={{ busy: isUpdatingView, disabled: isUpdatingView, selected: unreadOnly === onlyUnread }}
              disabled={isUpdatingView}
              key={String(onlyUnread)}
              onPress={() => { void changeUnreadFilter(onlyUnread) }}
              style={[styles.filterTab, unreadOnly === onlyUnread ? styles.filterTabSelected : null]}
            >
              <Text style={[styles.filterText, unreadOnly === onlyUnread ? styles.filterTextSelected : null]}>{onlyUnread ? '未读' : '全部'}</Text>
              {onlyUnread && unreadCount > 0 ? <Text style={styles.unreadCount}>{unreadCount}</Text> : null}
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityLabel="选择信箱排序" accessibilityRole="button" accessibilityState={{ disabled: isUpdatingView, busy: isUpdatingView }} disabled={isUpdatingView} onPress={() => setSheet('sort')} ref={sortTriggerRef} style={styles.sortButton}>
          <Text style={styles.sortLabel}>{currentSort}</Text><Icon color={colors.muted} name="filter" size={16} />
        </Pressable>
      </View>
    </View>
  )
  const feedbackText = feedback === null ? null : <Text style={styles.feedback}>{feedback}</Text>

  return (
    <>
      <Screen
        focused={focused}
        headerAccessory={(
          <Pressable accessibilityLabel="信箱更多操作" accessibilityRole="button" onPress={() => setSheet('more')} ref={moreTriggerRef} style={styles.iconButton}>
            <Icon color={colors.text} name="more" size={24} />
          </Pressable>
        )}
        title="信箱"
        tone="reading"
        toolbar={toolbar}
      >
        {searching ? <Text style={styles.resultSummary}>“{viewOptions.searchQuery}”{unreadOnly ? '的未读结果' : '的搜索结果'}</Text> : null}
        {messages.length === 0 ? (
          <EmptyState
            icon={unreadOnly ? 'read' : 'inbox'}
            title={searching ? (unreadOnly ? '没有匹配的未读消息。' : '没有匹配的本机信箱消息。') : unreadOnly ? '未读消息都处理完了。' : '最近还没有 Agent 来信。'}
            description={searching ? '试试其他关键词，或清除搜索查看全部消息。' : unreadOnly ? '切换到「全部」，可以继续阅读已有消息。' : '来自 Agent 的消息，集中留在本机。'}
          />
        ) : (
          <View style={styles.list}>
            {messages.map(message => <MessageListItem key={message.messageId} message={message} now={now} onOpen={() => onOpenMessage(message.messageId)} />)}
          </View>
        )}
        {sheet === null ? feedbackText : null}
      </Screen>
      <ActionSheet dismissible={!isClearing && !isMarkingAll && !isUpdatingView} onClose={closeSheet} title={sheet === 'sort' ? '消息排序' : '信箱操作'} visible={sheet !== null}>
        {sheet === 'sort' ? (
          <View accessibilityRole="radiogroup" style={styles.sheetContent}>
            {SORT_OPTIONS.map(option => (
              <AccessibleAction
                busy={isUpdatingView}
                key={option.value}
                label={`信箱排序：${option.label}`}
                onPress={() => { void changeSort(option.value) }}
                role="radio"
                selected={viewOptions.sort === option.value}
                variant="secondary"
                visualLabel={option.label}
              />
            ))}
          </View>
        ) : confirmingClear ? (
          <View style={styles.sheetContent}>
            <Text accessibilityRole="header" ref={confirmationTitleRef} style={styles.confirmationTitle}>确认清空本机信箱？</Text>
            <Text style={styles.confirmationBody}>此操作不可恢复，只删除本机信箱消息。它不会删除 command 防重放记录、活动审计、设置或凭证；同一 commandId 重放也不会重建已清空的消息。</Text>
            <View style={styles.actionRow}>
              <AccessibleAction busy={isClearing} label="取消清空本机信箱" onPress={() => { setConfirmingClear(false); setFeedback(null) }} style={styles.flexButton} variant="secondary" visualLabel="取消" />
              <AccessibleAction accessibilityHint="不可恢复地删除当前本机信箱内容" busy={isClearing} icon="trash" label="确认清空本机信箱" onPress={() => { void clearInbox() }} style={styles.flexButton} variant="danger" visualLabel={isClearing ? '正在清空…' : '确认清空'} />
            </View>
          </View>
        ) : (
          <View style={styles.sheetContent}>
            {unreadCount === 0 ? null : <AccessibleAction busy={isMarkingAll} icon="read" label="将本机信箱全部标为已读" onPress={() => { void markAllRead() }} variant="secondary" visualLabel={isMarkingAll ? '标记中…' : '全部标为已读'} />}
            <AccessibleAction accessibilityHint="先显示只删除本机信箱内容的范围确认，不会立即删除" disabled={isMarkingAll} icon="trash" label="清空本机信箱" onPress={() => { setFeedback(null); setConfirmingClear(true) }} ref={clearTriggerRef} variant="secondary" />
            <Text style={styles.scopeNote}>操作范围为本机全部消息，包含当前筛选以外的消息。</Text>
          </View>
        )}
        {feedbackText}
      </ActionSheet>
    </>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  confirmationBody: { color: colors.muted, fontSize: 15, lineHeight: 24 },
  confirmationTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  feedback: { color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: radius.sm, padding: spacing.md, fontSize: 14, lineHeight: 21 },
  flexButton: { flexBasis: 120, flexGrow: 1 },
  sheetContent: { gap: spacing.md },
  scopeNote: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  item: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xl },
  itemBody: { gap: spacing.sm },
  itemMetaLine: { alignItems: 'center', gap: spacing.sm, flexDirection: 'row' },
  itemCaller: { color: colors.muted, flex: 1, fontSize: 13, lineHeight: 18 },
  itemCallerUnread: { color: colors.text, fontWeight: '600' },
  itemTime: { color: colors.muted, fontSize: 12, flexShrink: 0 },
  itemTitle: { color: colors.text, fontSize: 18, fontWeight: '500', lineHeight: 26, letterSpacing: -0.2 },
  itemTitleUnread: { fontWeight: '700' },
  itemSummary: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  itemPressed: { opacity: 0.65 },
  list: { marginTop: -spacing.lg },
  toolbar: { gap: spacing.xs },
  searchBar: { alignItems: 'center', backgroundColor: colors.panelElevated, borderRadius: radius.md, gap: spacing.sm, flexDirection: 'row', paddingLeft: spacing.md },
  searchInput: { color: colors.text, flex: 1, fontSize: 16, minHeight: 48, paddingVertical: spacing.md, paddingRight: spacing.md },
  filterRow: { alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexDirection: 'row' },
  filterTabs: { flexDirection: 'row', gap: spacing.lg },
  filterTab: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: spacing.xs, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterTabSelected: { borderBottomColor: colors.primary },
  filterText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  filterTextSelected: { color: colors.primary },
  unreadCount: { color: colors.primary, backgroundColor: colors.primarySoft, fontSize: 11, fontWeight: '700', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  sortButton: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  sortLabel: { color: colors.muted, fontSize: 13 },
  resultSummary: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  unreadDot: { backgroundColor: 'transparent', borderRadius: 3, height: 6, width: 6 },
  unreadDotActive: { backgroundColor: colors.primary },
  urgencyCritical: { color: colors.danger },
  urgencyHigh: { color: colors.warning },
  urgencyTag: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '600' },
})
