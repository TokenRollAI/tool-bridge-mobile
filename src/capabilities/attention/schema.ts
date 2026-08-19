import { z } from 'zod'

const safeMessage = z.string()
  .max(120)
  .refine(
    value => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value),
    'message 不能包含控制或双向覆盖字符',
  )

export const ringArgumentsSchema = z.strictObject({
  durationSeconds: z.number().int().min(1).max(120).default(30),
  flash: z.boolean().default(false),
  message: safeMessage.optional(),
  sound: z.literal('find_device').default('find_device'),
  vibrate: z.boolean().default(true),
}).refine(value => value.sound === 'find_device' || value.vibrate || value.flash, {
  message: '至少请求一个 attention channel',
})

export const stopArgumentsSchema = z.strictObject({
  sessionId: z.string().min(1).max(128).optional(),
})

export type RingArguments = z.infer<typeof ringArgumentsSchema>
export type StopArguments = z.infer<typeof stopArgumentsSchema>

export type AttentionChannelResult =
  | Readonly<{ status: 'requested' }>
  | Readonly<{ reason: string; status: 'unavailable' }>

export type RingResult = Readonly<{
  channels: Readonly<{
    flash: AttentionChannelResult
    sound: AttentionChannelResult
    vibration: AttentionChannelResult
  }>
  expiresAt: string
  sessionId: string
}>

export type StopResult = Readonly<{
  sessionId: string | null
  status: 'stopped' | 'not_active'
}>
