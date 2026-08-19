import { z } from 'zod'

export const statusArgumentsSchema = z.strictObject({})

const batterySummarySchema = z.strictObject({
  charging: z.boolean(),
  level: z.number().min(0).max(1),
  lowPowerMode: z.boolean(),
})

const networkSummarySchema = z.strictObject({
  internetReachable: z.boolean().nullable(),
  type: z.string(),
})

function fieldAvailabilitySchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('availability', [
    z.strictObject({ availability: z.literal('available'), value }),
    z.strictObject({ availability: z.literal('unavailable'), reason: z.string() }),
  ])
}

export const statusResultSchema = z.strictObject({
  appState: z.string(),
  battery: fieldAvailabilitySchema(batterySummarySchema),
  controlMode: z.string(),
  installationId: z.string(),
  network: fieldAvailabilitySchema(networkSummarySchema),
  observedAt: z.string(),
  platform: z.enum(['android', 'ios', 'unknown']),
  reachability: z.string(),
})

export type StatusArguments = z.infer<typeof statusArgumentsSchema>

export type FieldAvailability<Value> =
  | Readonly<{ availability: 'available'; value: Value }>
  | Readonly<{ availability: 'unavailable'; reason: string }>

export type BatterySummary = Readonly<{
  charging: boolean
  level: number
  lowPowerMode: boolean
}>

export type NetworkSummary = Readonly<{
  internetReachable: boolean | null
  type: string
}>

export type StatusObservation = Readonly<{
  battery: FieldAvailability<BatterySummary>
  network: FieldAvailability<NetworkSummary>
  observedAt: string
  platform: 'android' | 'ios' | 'unknown'
}>

export type StatusResult = z.infer<typeof statusResultSchema>
