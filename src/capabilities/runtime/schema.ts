import { z } from 'zod'

export const runtimeEmptyArgumentsSchema = z.strictObject({})

export const runtimeCancelArgumentsSchema = z.strictObject({
  commandId: z.string().min(1).max(128),
})

const availabilitySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('available') }),
  z.strictObject({
    permission: z.string(),
    reason: z.string(),
    status: z.literal('permission_required'),
  }),
  z.strictObject({ reason: z.string(), status: z.literal('unavailable') }),
])

export const runtimeCapabilitiesResultSchema = z.strictObject({
  capabilities: z.array(z.strictObject({
    availability: availabilitySchema,
    // 能力自身声明的静态确认策略；仅是内在元数据，不代表当前控制模式下的实际行为。
    confirmation: z.enum(['always', 'never', 'when_locked']),
    description: z.string(),
    effect: z.enum(['read', 'write', 'destructive']),
    // 当前控制模式下的“有效确认策略”：required 表示此刻调用会触发本地确认，
    // not_required 表示不会。由同一个 PolicyEngine 裁决得出，与 SDK expose 的 confirm 提示同源，
    // 让 Agent 无需综合 confirmation/effect/risk/controlMode 自行推断。
    effectiveConfirmation: z.enum(['required', 'not_required']),
    path: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
    tool: z.string(),
  })),
  observedAt: z.string(),
})

export const runtimePendingCommandsResultSchema = z.strictObject({
  commands: z.array(z.strictObject({
    commandId: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    path: z.string(),
    state: z.enum(['active', 'awaiting_user']),
    tool: z.string(),
  })),
  identityScope: z.literal('gateway_credential_principal'),
})

export const runtimeCancelResultSchema = z.strictObject({
  commandId: z.string(),
  status: z.enum(['cancellation_requested', 'not_active']),
})

export type RuntimeCancelArguments = z.infer<typeof runtimeCancelArgumentsSchema>
export type RuntimeCapabilitiesResult = z.infer<typeof runtimeCapabilitiesResultSchema>
export type RuntimePendingCommandsResult = z.infer<typeof runtimePendingCommandsResultSchema>
export type RuntimeCancelResult = z.infer<typeof runtimeCancelResultSchema>
