import { z } from 'zod'

export type Effect = 'read' | 'write' | 'destructive'
export type Risk = 'low' | 'medium' | 'high'
export type Confirmation = 'never' | 'when_locked' | 'always'
export type QueuePolicy = 'reject_offline' | 'enqueue'

export type ControlMode = 'disabled' | 'ask_every_time' | 'trusted_session' | 'direct_call'

const unsafeUiControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const boundedIdentifier = z.string().min(1).max(256).refine(value => !unsafeUiControl.test(value), {
  message: '标识符不能包含控制或双向覆盖字符',
})
const callerDisplayName = z.string().min(1).max(120).refine(
  value => !unsafeUiControl.test(value),
  { message: '调用方名称不能包含控制或双向覆盖字符' },
)
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), {
  message: '必须是有效时间戳',
})

export const toolErrorSchema = z.strictObject({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
})

export const commandOutcomeSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.json() }),
  z.strictObject({ error: toolErrorSchema, ok: z.literal(false) }),
])

// 这是 transport adapter 交给本地执行器的归一化模型，不是自定义 gateway wire schema。
export const localCommandSchema = z.strictObject({
  arguments: z.record(z.string(), z.unknown()),
  caller: z.strictObject({
    displayName: callerDisplayName.optional(),
    subjectId: boundedIdentifier,
  }),
  commandId: z.string().min(1).max(128),
  createdAt: timestamp,
  expiresAt: timestamp,
  path: z.string().min(1).max(256).regex(/^[a-z0-9][a-z0-9_/-]*$/),
  tool: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9_.-]*$/),
})

export type ToolError = z.infer<typeof toolErrorSchema>
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>
export type LocalCommand = z.infer<typeof localCommandSchema>

export type CommandStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'unknown_after_crash'

export type StoredCommand = Readonly<{
  commandId: string
  completedAt: string | null
  outcome: CommandOutcome | null
  path: string
  receivedAt: string
  status: CommandStatus
  tool: string
}>
