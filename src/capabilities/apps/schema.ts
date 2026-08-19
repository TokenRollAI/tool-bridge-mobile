import { z } from 'zod'

export const appUrlArgumentsSchema = z.strictObject({
  url: z.string().min(1).max(2_048),
})

export const appUrlTargetSchema = z.strictObject({
  host: z.string(),
  kind: z.literal('https'),
})

export const appCanOpenResultSchema = z.strictObject({
  canOpen: z.boolean(),
  target: appUrlTargetSchema,
})

export const appOpenResultSchema = z.strictObject({
  status: z.literal('handed_off'),
  target: appUrlTargetSchema,
})

export type AppUrlArguments = z.infer<typeof appUrlArgumentsSchema>
