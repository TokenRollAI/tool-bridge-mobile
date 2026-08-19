import { z } from 'zod'

const displayText = z.string().min(1).max(120).refine(value => (
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
), {
  message: '不能包含控制或双向覆盖字符',
})

export const mediaPlayArgumentsSchema = z.strictObject({
  artist: displayText.optional(),
  source: z.strictObject({
    kind: z.literal('https'),
    url: z.string().min(1).max(2_048),
  }),
  title: displayText,
})

export const mediaSessionArgumentsSchema = z.strictObject({
  sessionId: z.string().min(1).max(128),
})

export const mediaSeekArgumentsSchema = z.strictObject({
  positionMs: z.number().int().min(0).max(7_200_000),
  sessionId: z.string().min(1).max(128),
})

export const mediaSessionResultSchema = z.strictObject({
  artist: z.string().nullable(),
  callerSubjectId: z.string(),
  currentTimeSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive().nullable(),
  mimeType: z.string(),
  sessionId: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sourceHost: z.string(),
  state: z.enum(['loading', 'playing', 'paused', 'interrupted', 'stopped', 'failed']),
  title: z.string(),
})

export type MediaPlayArguments = z.infer<typeof mediaPlayArgumentsSchema>
export type MediaSeekArguments = z.infer<typeof mediaSeekArgumentsSchema>
export type MediaSessionArguments = z.infer<typeof mediaSessionArgumentsSchema>
