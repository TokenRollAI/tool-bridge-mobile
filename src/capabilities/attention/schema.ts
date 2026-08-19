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

export const attentionChannelResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('requested') }),
  z.strictObject({ reason: z.string(), status: z.literal('unavailable') }),
])

export const ringResultSchema = z.strictObject({
  channels: z.strictObject({
    flash: attentionChannelResultSchema,
    sound: attentionChannelResultSchema,
    vibration: attentionChannelResultSchema,
  }),
  expiresAt: z.string(),
  sessionId: z.string(),
})

export const stopResultSchema = z.strictObject({
  sessionId: z.string().nullable(),
  status: z.enum(['stopped', 'not_active']),
})

export type RingArguments = z.infer<typeof ringArgumentsSchema>
export type StopArguments = z.infer<typeof stopArgumentsSchema>

export type AttentionChannelResult = z.infer<typeof attentionChannelResultSchema>
export type RingResult = z.infer<typeof ringResultSchema>
export type StopResult = z.infer<typeof stopResultSchema>
