import type { CommandOutcome, LocalCommand, StoredCommand } from './types'

export const LOCAL_COMMAND_RETENTION_LIMIT = 10_000

export type CommandClaim =
  | Readonly<{ kind: 'started' }>
  | Readonly<{ kind: 'replay'; outcome: CommandOutcome }>
  | Readonly<{ kind: 'in_progress' }>

export interface CommandRepository {
  claim(command: LocalCommand, receivedAt: string): Promise<CommandClaim>
  complete(commandId: string, outcome: CommandOutcome, completedAt: string): Promise<void>
  get(commandId: string): Promise<StoredCommand | null>
  pruneTerminal(retainCount: number): Promise<number>
  recoverInterrupted(recoveredAt: string): Promise<number>
}
