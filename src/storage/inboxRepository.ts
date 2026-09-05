import { LOCAL_INBOX_RETENTION_LIMIT } from '@/inbox/types'

import type { MobileDatabase } from './database'
import type {
  InboxMessage,
  InboxMessageCategory,
  InboxMessageFormat,
  InboxMessageUrgency,
  InboxMessageWrite,
  InboxRepository,
  InboxSort,
  InboxViewOptions,
} from '@/inbox/types'

type InboxMessageRow = Readonly<{
  body: string
  caller_display_name: string | null
  caller_subject_id: string
  category: InboxMessageCategory
  format: InboxMessageFormat
  message_id: string
  read_at: string | null
  received_at: string
  sent_at: string | null
  source_command_id: string
  source_label: string | null
  title: string
  urgency: InboxMessageUrgency
}>

const INBOX_COLUMNS = `
  message_id, source_command_id, caller_subject_id, caller_display_name,
  category, source_label, title, body, format, urgency, sent_at, received_at, read_at
`

const INBOX_ORDER_SQL: Readonly<Record<InboxSort, string>> = {
  read_first: 'CASE WHEN read_at IS NULL THEN 1 ELSE 0 END ASC, received_at DESC, message_id DESC',
  received_asc: 'received_at ASC, message_id ASC',
  received_desc: 'received_at DESC, message_id DESC',
  sent_asc: 'COALESCE(sent_at, received_at) ASC, message_id ASC',
  sent_desc: 'COALESCE(sent_at, received_at) DESC, message_id DESC',
  unread_first: 'CASE WHEN read_at IS NULL THEN 0 ELSE 1 END ASC, received_at DESC, message_id DESC',
}

const PRUNE_INBOX_SQL = `DELETE FROM inbox_messages WHERE message_id IN (
  SELECT message_id FROM inbox_messages
  WHERE message_id <> ?
  ORDER BY received_at ASC, message_id ASC
  LIMIT (
    SELECT CASE WHEN COUNT(*) > ? THEN COUNT(*) - ? ELSE 0 END
    FROM inbox_messages
  )
)`

function toInboxMessage(row: InboxMessageRow): InboxMessage {
  return {
    body: row.body,
    callerDisplayName: row.caller_display_name,
    callerSubjectId: row.caller_subject_id,
    category: row.category,
    format: row.format,
    messageId: row.message_id,
    readAt: row.read_at,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    sourceCommandId: row.source_command_id,
    sourceLabel: row.source_label,
    title: row.title,
    urgency: row.urgency,
  }
}

function searchPattern(query: string): string {
  return `%${query.replace(/[!%_]/g, character => `!${character}`)}%`
}

function messageMatches(message: InboxMessage, query: string): boolean {
  if (query === '') return true
  const normalized = query.toLocaleLowerCase()
  return [
    message.title,
    message.body,
    message.sourceLabel ?? '',
    message.callerDisplayName ?? '',
    message.callerSubjectId,
  ].some(value => value.toLocaleLowerCase().includes(normalized))
}

function compareInboxMessages(sort: InboxSort, left: InboxMessage, right: InboxMessage): number {
  const byReceivedDesc = right.receivedAt.localeCompare(left.receivedAt)
    || right.messageId.localeCompare(left.messageId)
  if (sort === 'received_desc') return byReceivedDesc
  if (sort === 'received_asc') {
    return left.receivedAt.localeCompare(right.receivedAt)
      || left.messageId.localeCompare(right.messageId)
  }
  if (sort === 'sent_desc') {
    return (right.sentAt ?? right.receivedAt).localeCompare(left.sentAt ?? left.receivedAt)
      || right.messageId.localeCompare(left.messageId)
  }
  if (sort === 'sent_asc') {
    return (left.sentAt ?? left.receivedAt).localeCompare(right.sentAt ?? right.receivedAt)
      || left.messageId.localeCompare(right.messageId)
  }
  const leftUnread = left.readAt === null
  const rightUnread = right.readAt === null
  if (leftUnread !== rightUnread) {
    if (sort === 'unread_first') return leftUnread ? -1 : 1
    return leftUnread ? 1 : -1
  }
  return byReceivedDesc
}

export class SqliteInboxRepository implements InboxRepository {
  constructor(private readonly database: MobileDatabase) {}

  async add(message: InboxMessageWrite): Promise<InboxMessage> {
    let stored: InboxMessage | null = null
    await this.database.raw.withExclusiveTransactionAsync(async transaction => {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO inbox_messages(
          message_id, source_command_id, caller_subject_id, caller_display_name,
          category, source_label, title, body, format, urgency, sent_at, received_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        message.messageId,
        message.sourceCommandId,
        message.callerSubjectId,
        message.callerDisplayName,
        message.category,
        message.sourceLabel,
        message.title,
        message.body,
        message.format,
        message.urgency,
        message.sentAt,
        message.receivedAt,
      )
      const row = await transaction.getFirstAsync<InboxMessageRow>(
        `SELECT ${INBOX_COLUMNS} FROM inbox_messages WHERE source_command_id = ?`,
        message.sourceCommandId,
      )
      if (row === null || row.message_id !== message.messageId) {
        throw new Error('信箱消息写入冲突后未找到确定性记录')
      }
      stored = toInboxMessage(row)
      await transaction.runAsync(
        PRUNE_INBOX_SQL,
        message.messageId,
        LOCAL_INBOX_RETENTION_LIMIT,
        LOCAL_INBOX_RETENTION_LIMIT,
      )
    })
    if (stored === null) throw new Error('信箱消息写入事务没有结果')
    return stored
  }

  async clear(): Promise<number> {
    const deletion = await this.database.raw.runAsync('DELETE FROM inbox_messages')
    return deletion.changes
  }

  async countUnread(): Promise<number> {
    const row = await this.database.raw.getFirstAsync<{ unread_count: number }>(
      'SELECT COUNT(*) AS unread_count FROM inbox_messages WHERE read_at IS NULL',
    )
    return row?.unread_count ?? 0
  }

  async list(options: InboxViewOptions, limit: number): Promise<readonly InboxMessage[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 200))
    const query = options.searchQuery.trim()
    const searchClause = query === '' ? '' : `(
      title LIKE ? ESCAPE '!' COLLATE NOCASE
      OR body LIKE ? ESCAPE '!' COLLATE NOCASE
      OR source_label LIKE ? ESCAPE '!' COLLATE NOCASE
      OR caller_display_name LIKE ? ESCAPE '!' COLLATE NOCASE
      OR caller_subject_id LIKE ? ESCAPE '!' COLLATE NOCASE
    )`
    // 过滤必须先于 LIMIT，避免近期已读消息挤掉较早的未读消息。
    const clauses = [options.unreadOnly === true ? 'read_at IS NULL' : '', searchClause].filter(Boolean)
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const parameters = query === '' ? [] : Array(5).fill(searchPattern(query))
    const rows = await this.database.raw.getAllAsync<InboxMessageRow>(
      `SELECT ${INBOX_COLUMNS} FROM inbox_messages
       ${where} ORDER BY ${INBOX_ORDER_SQL[options.sort]} LIMIT ?`,
      ...parameters,
      boundedLimit,
    )
    return rows.map(toInboxMessage)
  }

  async markAllRead(readAt: string): Promise<number> {
    const update = await this.database.raw.runAsync(
      'UPDATE inbox_messages SET read_at = ? WHERE read_at IS NULL',
      readAt,
    )
    return update.changes
  }

  async markRead(messageId: string, readAt: string): Promise<boolean> {
    const update = await this.database.raw.runAsync(
      `UPDATE inbox_messages SET read_at = ?
       WHERE message_id = ? AND read_at IS NULL`,
      readAt,
      messageId,
    )
    return update.changes === 1
  }
}

export class MemoryInboxRepository implements InboxRepository {
  readonly records = new Map<string, InboxMessage>()

  async add(message: InboxMessageWrite): Promise<InboxMessage> {
    const existing = [...this.records.values()].find(record => (
      record.sourceCommandId === message.sourceCommandId
    ))
    if (existing !== undefined) {
      if (existing.messageId !== message.messageId) {
        throw new Error('信箱消息写入冲突后未找到确定性记录')
      }
      return existing
    }
    if (this.records.has(message.messageId)) {
      throw new Error('信箱消息写入冲突后未找到确定性记录')
    }
    const stored = { ...message, readAt: null }
    this.records.set(stored.messageId, stored)
    const deleteCount = Math.max(0, this.records.size - LOCAL_INBOX_RETENTION_LIMIT)
    const recordsToDelete = [...this.records.values()]
      .filter(record => record.messageId !== stored.messageId)
      .sort((left, right) => (
        left.receivedAt.localeCompare(right.receivedAt)
        || left.messageId.localeCompare(right.messageId)
      ))
      .slice(0, deleteCount)
    for (const record of recordsToDelete) this.records.delete(record.messageId)
    return stored
  }

  async clear(): Promise<number> {
    const deleted = this.records.size
    this.records.clear()
    return deleted
  }

  async countUnread(): Promise<number> {
    return [...this.records.values()].filter(record => record.readAt === null).length
  }

  async list(options: InboxViewOptions, limit: number): Promise<readonly InboxMessage[]> {
    return [...this.records.values()]
      .filter(message => options.unreadOnly !== true || message.readAt === null)
      .filter(message => messageMatches(message, options.searchQuery.trim()))
      .sort((left, right) => compareInboxMessages(options.sort, left, right))
      .slice(0, Math.max(1, Math.min(limit, 200)))
  }

  async markAllRead(readAt: string): Promise<number> {
    let changed = 0
    for (const [messageId, message] of this.records.entries()) {
      if (message.readAt !== null) continue
      this.records.set(messageId, { ...message, readAt })
      changed += 1
    }
    return changed
  }

  async markRead(messageId: string, readAt: string): Promise<boolean> {
    const message = this.records.get(messageId)
    if (message === undefined || message.readAt !== null) return false
    this.records.set(messageId, { ...message, readAt })
    return true
  }
}
