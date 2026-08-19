import { z } from 'zod'

export const statusArgumentsSchema = z.strictObject({})

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

export type StatusResult = StatusObservation & Readonly<{
  appState: string
  controlMode: string
  installationId: string
  reachability: string
}>
