import { LOCAL_AUDIT_RETENTION_LIMIT } from '@/audit/types'

import type { MobileDatabase } from './database'
import type { AuditRecord, AuditRepository } from '@/audit/types'


type AuditRow = Readonly<{
  caller_subject_id: string
  client_version: string
  command_id: string
  decision: AuditRecord['decision']
  effect: AuditRecord['effect']
  id: string
  occurred_at: string
  outcome_code: string
  path: string
  risk: AuditRecord['risk']
  tool: string
}>

function toAuditRecord(row: AuditRow): AuditRecord {
  return {
    callerSubjectId: row.caller_subject_id,
    clientVersion: row.client_version,
    commandId: row.command_id,
    decision: row.decision,
    effect: row.effect,
    id: row.id,
    occurredAt: row.occurred_at,
    outcomeCode: row.outcome_code,
    path: row.path,
    risk: row.risk,
    tool: row.tool,
  }
}

export class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly database: MobileDatabase) {}

  async add(record: AuditRecord): Promise<void> {
    await this.database.raw.withExclusiveTransactionAsync(async transaction => {
      await transaction.runAsync(
        `INSERT INTO audit_records(
          id, command_id, occurred_at, caller_subject_id, path, tool, effect, risk,
          decision, outcome_code, client_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.commandId,
        record.occurredAt,
        record.callerSubjectId,
        record.path,
        record.tool,
        record.effect,
        record.risk,
        record.decision,
        record.outcomeCode,
        record.clientVersion,
      )
      await transaction.runAsync(
        `DELETE FROM audit_records WHERE id IN (
           SELECT id FROM audit_records
           ORDER BY occurred_at DESC, id DESC
           LIMIT -1 OFFSET ?
         )`,
        LOCAL_AUDIT_RETENTION_LIMIT,
      )
    })
  }

  async clear(): Promise<number> {
    const deletion = await this.database.raw.runAsync('DELETE FROM audit_records')
    return deletion.changes
  }

  async listRecent(limit: number): Promise<readonly AuditRecord[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 200))
    const rows = await this.database.raw.getAllAsync<AuditRow>(
      `SELECT id, command_id, occurred_at, caller_subject_id, path, tool, effect,
              risk, decision, outcome_code, client_version
       FROM audit_records ORDER BY occurred_at DESC LIMIT ?`,
      boundedLimit,
    )
    return rows.map(toAuditRecord)
  }

  async prune(retainCount: number): Promise<number> {
    const boundedRetainCount = Math.max(1, Math.min(retainCount, 10_000))
    const deletion = await this.database.raw.runAsync(
      `DELETE FROM audit_records WHERE id IN (
         SELECT id FROM audit_records
         ORDER BY occurred_at DESC, id DESC
         LIMIT -1 OFFSET ?
       )`,
      boundedRetainCount,
    )
    return deletion.changes
  }
}
