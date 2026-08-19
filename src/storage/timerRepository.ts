import type { MobileDatabase } from './database'
import type { CommandStatus } from '@/commands/types'

export type TimerState =
  | 'preparing'
  | 'scheduled'
  | 'cancelling'
  | 'cancelled'
  | 'deadline_elapsed'
  | 'status_unknown'

export type StoredTimer = Readonly<{
  cancelledAt: string | null
  createdAt: string
  firesAt: string
  notificationId: string
  ownerSubjectId: string
  sourceCommandId: string
  state: TimerState
  timerId: string
  updatedAt: string
}>

export type TimerForReconciliation = StoredTimer & Readonly<{
  sourceCommandStatus: CommandStatus | null
}>

export type TimerReservation = Readonly<{
  firesAt: string
  notificationId: string
  now: string
  ownerSubjectId: string
  sourceCommandId: string
  timerId: string
}>

export type TimerReserveResult =
  | Readonly<{ kind: 'reserved'; timer: StoredTimer }>
  | Readonly<{ kind: 'caller_capacity' }>
  | Readonly<{ kind: 'global_capacity' }>
  | Readonly<{ kind: 'existing'; timer: StoredTimer }>

export interface TimerRepository {
  getForOwner(timerId: string, ownerSubjectId: string): Promise<StoredTimer | null>
  listActive(): Promise<readonly StoredTimer[]>
  listForReconciliation(): Promise<readonly TimerForReconciliation[]>
  markState(
    timerId: string,
    expected: readonly TimerState[],
    state: TimerState,
    updatedAt: string,
  ): Promise<boolean>
  pruneTerminal(retainCount: number): Promise<number>
  reserve(
    reservation: TimerReservation,
    limits: Readonly<{ maxGlobal: number; maxPerCaller: number }>,
  ): Promise<TimerReserveResult>
}

type TimerRow = Readonly<{
  cancelled_at: string | null
  created_at: string
  fires_at: string
  notification_id: string
  owner_subject_id: string
  source_command_id: string
  state: TimerState
  timer_id: string
  updated_at: string
}>

type ReconciliationRow = TimerRow & Readonly<{
  source_command_status: CommandStatus | null
}>

const ACTIVE_STATES: readonly TimerState[] = [
  'preparing',
  'scheduled',
  'cancelling',
  'status_unknown',
]

function toStoredTimer(row: TimerRow): StoredTimer {
  return {
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    firesAt: row.fires_at,
    notificationId: row.notification_id,
    ownerSubjectId: row.owner_subject_id,
    sourceCommandId: row.source_command_id,
    state: row.state,
    timerId: row.timer_id,
    updatedAt: row.updated_at,
  }
}

const TIMER_COLUMNS = `
  timer_id, source_command_id, owner_subject_id, notification_id, fires_at,
  state, created_at, updated_at, cancelled_at
`

export class SqliteTimerRepository implements TimerRepository {
  constructor(private readonly database: MobileDatabase) {}

  async getForOwner(timerId: string, ownerSubjectId: string): Promise<StoredTimer | null> {
    const row = await this.database.raw.getFirstAsync<TimerRow>(
      `SELECT ${TIMER_COLUMNS} FROM timers
       WHERE timer_id = ? AND owner_subject_id = ?`,
      timerId,
      ownerSubjectId,
    )
    return row === null ? null : toStoredTimer(row)
  }

  async listActive(): Promise<readonly StoredTimer[]> {
    const rows = await this.database.raw.getAllAsync<TimerRow>(
      `SELECT ${TIMER_COLUMNS} FROM timers
       WHERE state IN ('preparing', 'scheduled', 'cancelling', 'status_unknown')
       ORDER BY fires_at ASC, timer_id ASC`,
    )
    return rows.map(toStoredTimer)
  }

  async listForReconciliation(): Promise<readonly TimerForReconciliation[]> {
    const rows = await this.database.raw.getAllAsync<ReconciliationRow>(
      `SELECT ${TIMER_COLUMNS}, commands.status AS source_command_status
       FROM timers LEFT JOIN commands ON commands.command_id = timers.source_command_id
       WHERE timers.state IN ('preparing', 'scheduled', 'cancelling', 'status_unknown')
       ORDER BY timers.fires_at ASC, timers.timer_id ASC`,
    )
    return rows.map(row => ({
      ...toStoredTimer(row),
      sourceCommandStatus: row.source_command_status,
    }))
  }

  async markState(
    timerId: string,
    expected: readonly TimerState[],
    state: TimerState,
    updatedAt: string,
  ): Promise<boolean> {
    if (expected.length === 0) return false
    const placeholders = expected.map(() => '?').join(', ')
    const update = await this.database.raw.runAsync(
      `UPDATE timers SET state = ?, updated_at = ?,
         cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END
       WHERE timer_id = ? AND state IN (${placeholders})`,
      state,
      updatedAt,
      state,
      updatedAt,
      timerId,
      ...expected,
    )
    return update.changes === 1
  }

  async reserve(
    reservation: TimerReservation,
    limits: Readonly<{ maxGlobal: number; maxPerCaller: number }>,
  ): Promise<TimerReserveResult> {
    let result: TimerReserveResult | null = null
    await this.database.raw.withExclusiveTransactionAsync(async transaction => {
      const existing = await transaction.getFirstAsync<TimerRow>(
        `SELECT ${TIMER_COLUMNS} FROM timers WHERE timer_id = ? OR source_command_id = ?`,
        reservation.timerId,
        reservation.sourceCommandId,
      )
      if (existing !== null) {
        result = { kind: 'existing', timer: toStoredTimer(existing) }
        return
      }

      const counts = await transaction.getFirstAsync<{ caller_count: number; global_count: number }>(
        `SELECT COUNT(*) AS global_count,
          SUM(CASE WHEN owner_subject_id = ? THEN 1 ELSE 0 END) AS caller_count
         FROM timers WHERE state IN ('preparing', 'scheduled', 'cancelling', 'status_unknown')`,
        reservation.ownerSubjectId,
      )
      if ((counts?.caller_count ?? 0) >= limits.maxPerCaller) {
        result = { kind: 'caller_capacity' }
        return
      }
      if ((counts?.global_count ?? 0) >= limits.maxGlobal) {
        result = { kind: 'global_capacity' }
        return
      }

      await transaction.runAsync(
        `INSERT INTO timers(
          timer_id, source_command_id, owner_subject_id, notification_id, fires_at,
          state, created_at, updated_at, cancelled_at
        ) VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, NULL)`,
        reservation.timerId,
        reservation.sourceCommandId,
        reservation.ownerSubjectId,
        reservation.notificationId,
        reservation.firesAt,
        reservation.now,
        reservation.now,
      )
      result = {
        kind: 'reserved',
        timer: {
          cancelledAt: null,
          createdAt: reservation.now,
          firesAt: reservation.firesAt,
          notificationId: reservation.notificationId,
          ownerSubjectId: reservation.ownerSubjectId,
          sourceCommandId: reservation.sourceCommandId,
          state: 'preparing',
          timerId: reservation.timerId,
          updatedAt: reservation.now,
        },
      }
    })
    if (result === null) throw new Error('timer reserve 事务没有结果')
    return result
  }

  async pruneTerminal(retainCount: number): Promise<number> {
    const boundedRetainCount = Math.max(1, Math.min(retainCount, 2_000))
    const deletion = await this.database.raw.runAsync(
      `DELETE FROM timers WHERE timer_id IN (
         SELECT timer_id FROM timers
         WHERE state IN ('cancelled', 'deadline_elapsed')
         ORDER BY updated_at DESC, timer_id DESC
         LIMIT -1 OFFSET ?
       )`,
      boundedRetainCount,
    )
    return deletion.changes
  }
}

export class MemoryTimerRepository implements TimerRepository {
  readonly records = new Map<string, StoredTimer>()
  readonly sourceCommandStatuses = new Map<string, CommandStatus>()

  async getForOwner(timerId: string, ownerSubjectId: string): Promise<StoredTimer | null> {
    const timer = this.records.get(timerId)
    return timer?.ownerSubjectId === ownerSubjectId ? timer : null
  }

  async listActive(): Promise<readonly StoredTimer[]> {
    return [...this.records.values()]
      .filter(timer => ACTIVE_STATES.includes(timer.state))
      .sort((left, right) => left.firesAt.localeCompare(right.firesAt))
  }

  async listForReconciliation(): Promise<readonly TimerForReconciliation[]> {
    return (await this.listActive()).map(timer => ({
      ...timer,
      sourceCommandStatus: this.sourceCommandStatuses.get(timer.sourceCommandId) ?? null,
    }))
  }

  async markState(
    timerId: string,
    expected: readonly TimerState[],
    state: TimerState,
    updatedAt: string,
  ): Promise<boolean> {
    const timer = this.records.get(timerId)
    if (timer === undefined || !expected.includes(timer.state)) return false
    this.records.set(timerId, {
      ...timer,
      cancelledAt: state === 'cancelled' ? updatedAt : timer.cancelledAt,
      state,
      updatedAt,
    })
    return true
  }

  async reserve(
    reservation: TimerReservation,
    limits: Readonly<{ maxGlobal: number; maxPerCaller: number }>,
  ): Promise<TimerReserveResult> {
    const existing = [...this.records.values()].find(timer => (
      timer.timerId === reservation.timerId
      || timer.sourceCommandId === reservation.sourceCommandId
    ))
    if (existing !== undefined) return { kind: 'existing', timer: existing }
    const active = [...this.records.values()].filter(timer => ACTIVE_STATES.includes(timer.state))
    if (active.filter(timer => timer.ownerSubjectId === reservation.ownerSubjectId).length
      >= limits.maxPerCaller) return { kind: 'caller_capacity' }
    if (active.length >= limits.maxGlobal) return { kind: 'global_capacity' }
    const timer: StoredTimer = {
      cancelledAt: null,
      createdAt: reservation.now,
      firesAt: reservation.firesAt,
      notificationId: reservation.notificationId,
      ownerSubjectId: reservation.ownerSubjectId,
      sourceCommandId: reservation.sourceCommandId,
      state: 'preparing',
      timerId: reservation.timerId,
      updatedAt: reservation.now,
    }
    this.records.set(timer.timerId, timer)
    return { kind: 'reserved', timer }
  }

  async pruneTerminal(retainCount: number): Promise<number> {
    const terminal = [...this.records.values()]
      .filter(timer => timer.state === 'cancelled' || timer.state === 'deadline_elapsed')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const deleted = terminal.slice(Math.max(1, retainCount))
    for (const timer of deleted) this.records.delete(timer.timerId)
    return deleted.length
  }
}
