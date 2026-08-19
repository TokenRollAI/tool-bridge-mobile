import { z } from 'zod'

export const appUrlArgumentsSchema = z.strictObject({
  url: z.string().min(1).max(2_048),
})

export type AppUrlArguments = z.infer<typeof appUrlArgumentsSchema>
