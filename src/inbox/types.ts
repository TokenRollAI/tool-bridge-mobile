export const LOCAL_INBOX_DISPLAY_LIMIT = 100
export const LOCAL_INBOX_RETENTION_LIMIT = 1_000
export const LOCAL_INBOX_SEARCH_LIMIT = 120

export type InboxMessageCategory = 'message' | 'subscription' | 'news' | 'update'
export type InboxMessageFormat = 'markdown'
export type InboxMessageUrgency = 'low' | 'normal' | 'high' | 'critical'
export type InboxSort =
  | 'received_desc'
  | 'received_asc'
  | 'sent_desc'
  | 'sent_asc'
  | 'unread_first'
  | 'read_first'

export type InboxViewOptions = Readonly<{
  searchQuery: string
  sort: InboxSort
}>

export const DEFAULT_INBOX_VIEW_OPTIONS: InboxViewOptions = {
  searchQuery: '',
  sort: 'received_desc',
}

export type InboxMessage = Readonly<{
  body: string
  callerDisplayName: string | null
  callerSubjectId: string
  category: InboxMessageCategory
  format: InboxMessageFormat
  messageId: string
  readAt: string | null
  receivedAt: string
  sentAt: string | null
  sourceCommandId: string
  sourceLabel: string | null
  title: string
  urgency: InboxMessageUrgency
}>

export type InboxMessageWrite = Omit<InboxMessage, 'readAt'>

export interface InboxRepository {
  add(message: InboxMessageWrite): Promise<InboxMessage>
  clear(): Promise<number>
  countUnread(): Promise<number>
  list(options: InboxViewOptions, limit: number): Promise<readonly InboxMessage[]>
  markAllRead(readAt: string): Promise<number>
  markRead(messageId: string, readAt: string): Promise<boolean>
}

export function normalizeInboxViewOptions(options: InboxViewOptions): InboxViewOptions {
  const searchQuery = options.searchQuery.trim()
  if (searchQuery.length > LOCAL_INBOX_SEARCH_LIMIT) {
    throw new Error(`信箱搜索词不能超过 ${LOCAL_INBOX_SEARCH_LIMIT} 个字符`)
  }
  return { searchQuery, sort: options.sort }
}
