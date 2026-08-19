import type { CommandOutcome, Effect, Risk } from '@/commands/types'

export type AuditDecision = 'allowed' | 'awaiting_user' | 'rejected' | 'replayed'

export const ACTIVITY_HISTORY_DISPLAY_LIMIT = 100
export const LOCAL_AUDIT_RETENTION_LIMIT = 5_000

export type AuditRecord = Readonly<{
  callerSubjectId: string
  clientVersion: string
  commandId: string
  decision: AuditDecision
  effect: Effect | 'unknown'
  id: string
  occurredAt: string
  outcomeCode: string
  path: string
  risk: Risk | 'unknown'
  tool: string
}>

export interface AuditRepository {
  add(record: AuditRecord): Promise<void>
  clear(): Promise<number>
  listRecent(limit: number): Promise<readonly AuditRecord[]>
  prune(retainCount: number): Promise<number>
}

export function outcomeCode(outcome: CommandOutcome): string {
  return outcome.ok ? 'succeeded' : outcome.error.code
}
