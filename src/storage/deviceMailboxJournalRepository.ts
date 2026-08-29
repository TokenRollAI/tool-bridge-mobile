import type { MobileDatabase } from './database'
import type {
  DeviceOperationJournal,
  DeviceOperationJournalEntry,
  DeviceOperationJournalState,
  TBErrorBody,
  TBErrorCode,
} from '@tool-bridge/sdk/device'

type DeviceOperationCompletion = NonNullable<DeviceOperationJournalEntry['completion']>

type DeviceOperationJournalRow = Readonly<{
  completion_json: unknown
  expires_at: unknown
  operation_id: unknown
  state: unknown
  updated_at: unknown
}>

const DEVICE_OPERATION_JOURNAL_COLUMNS = `
  operation_id, state, completion_json, expires_at, updated_at
`

const TB_ERROR_CODES: readonly TBErrorCode[] = [
  'not_found',
  'permission_denied',
  'invalid_argument',
  'conflict',
  'unavailable',
  'rate_limited',
  'internal',
]

function invalidJournalState(): Error {
  return new Error('数据库中的 device mailbox journal 状态无效')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isJournalState(value: unknown): value is DeviceOperationJournalState {
  return value === 'discovered' || value === 'executing' || value === 'terminal'
}

function isTBErrorCode(value: unknown): value is TBErrorCode {
  return typeof value === 'string' && TB_ERROR_CODES.includes(value as TBErrorCode)
}

function parseErrorBody(value: unknown): TBErrorBody {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['code', 'message', 'retryable'])
    || !isTBErrorCode(value.code)
    || typeof value.message !== 'string'
    || typeof value.retryable !== 'boolean'
  ) throw invalidJournalState()
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
  }
}

function parseCompletion(value: unknown): DeviceOperationCompletion {
  if (!isRecord(value) || typeof value.outcome !== 'string') throw invalidJournalState()
  if (value.outcome === 'succeeded') {
    if (!hasExactKeys(value, ['outcome', 'result'])) throw invalidJournalState()
    return { outcome: 'succeeded', result: value.result }
  }
  if (value.outcome === 'rejected' || value.outcome === 'failed') {
    if (!hasExactKeys(value, ['error', 'outcome'])) throw invalidJournalState()
    return { error: parseErrorBody(value.error), outcome: value.outcome }
  }
  if (value.outcome === 'result_unknown') {
    if (hasExactKeys(value, ['outcome'])) return { outcome: 'result_unknown' }
    if (!hasExactKeys(value, ['error', 'outcome'])) throw invalidJournalState()
    return { error: parseErrorBody(value.error), outcome: 'result_unknown' }
  }
  throw invalidJournalState()
}

function parseCompletionJson(source: unknown): DeviceOperationCompletion {
  if (typeof source !== 'string') throw invalidJournalState()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw invalidJournalState()
  }
  return parseCompletion(parsed)
}

function serializeCompletion(completion: DeviceOperationCompletion): string {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(completion)
  } catch {
    throw invalidJournalState()
  }
  if (encoded === undefined) throw invalidJournalState()
  parseCompletionJson(encoded)
  return encoded
}

function parseJournalRow(
  row: DeviceOperationJournalRow,
  expectedOperationId: string,
): DeviceOperationJournalEntry {
  if (
    typeof row.operation_id !== 'string'
    || row.operation_id === ''
    || row.operation_id !== expectedOperationId
    || !isJournalState(row.state)
    || !isTimestamp(row.expires_at)
    || !isTimestamp(row.updated_at)
  ) throw invalidJournalState()

  if (row.state === 'terminal') {
    return {
      completion: parseCompletionJson(row.completion_json),
      expiresAt: row.expires_at,
      operationId: row.operation_id,
      state: row.state,
      updatedAt: row.updated_at,
    }
  }
  if (row.completion_json !== null) throw invalidJournalState()
  return {
    expiresAt: row.expires_at,
    operationId: row.operation_id,
    state: row.state,
    updatedAt: row.updated_at,
  }
}

function entryValues(entry: DeviceOperationJournalEntry): readonly [
  string,
  DeviceOperationJournalState,
  string | null,
  string,
  string,
] {
  if (
    typeof entry.operationId !== 'string'
    || entry.operationId === ''
    || !isJournalState(entry.state)
    || !isTimestamp(entry.expiresAt)
    || !isTimestamp(entry.updatedAt)
    || (entry.state === 'terminal') !== (entry.completion !== undefined)
  ) throw invalidJournalState()
  const completionJson = entry.completion === undefined
    ? null
    : serializeCompletion(entry.completion)
  return [entry.operationId, entry.state, completionJson, entry.expiresAt, entry.updatedAt]
}

export class SqliteDeviceOperationJournal implements DeviceOperationJournal {
  constructor(private readonly database: MobileDatabase) {}

  async get(operationId: string): Promise<DeviceOperationJournalEntry | null> {
    if (operationId === '') throw invalidJournalState()
    const row = await this.database.raw.getFirstAsync<DeviceOperationJournalRow>(
      `SELECT ${DEVICE_OPERATION_JOURNAL_COLUMNS}
       FROM device_operation_journal WHERE operation_id = ?`,
      operationId,
    )
    return row === null ? null : parseJournalRow(row, operationId)
  }

  async put(entry: DeviceOperationJournalEntry): Promise<void> {
    const values = entryValues(entry)
    const update = await this.database.raw.runAsync(
      `INSERT INTO device_operation_journal(
        operation_id, state, completion_json, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        state = excluded.state,
        completion_json = excluded.completion_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
      ...values,
    )
    if (update.changes !== 1) throw new Error('device mailbox journal 持久化失败')
  }

  async remove(operationId: string): Promise<void> {
    if (operationId === '') throw invalidJournalState()
    await this.database.raw.runAsync(
      'DELETE FROM device_operation_journal WHERE operation_id = ?',
      operationId,
    )
  }

  async garbageCollectExpired(now: string): Promise<number> {
    if (!isTimestamp(now)) throw invalidJournalState()
    const deletion = await this.database.raw.runAsync(
      `DELETE FROM device_operation_journal
       WHERE julianday(expires_at) <= julianday(?)`,
      now,
    )
    return deletion.changes
  }
}
