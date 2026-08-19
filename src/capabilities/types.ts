import type {
  Confirmation,
  ControlMode,
  Effect,
  LocalCommand,
  QueuePolicy,
  Risk,
} from '@/commands/types'
import type { z } from 'zod'


export type RuntimeAppState = 'active' | 'background' | 'inactive' | 'unknown'
export type Reachability = 'disabled' | 'offline' | 'online' | 'unconfigured'

export type CapabilityAvailability =
  | Readonly<{ status: 'available' }>
  | Readonly<{ permission: string; reason: string; status: 'permission_required' }>
  | Readonly<{ reason: string; status: 'unavailable' }>

export type CapabilityContext = Readonly<{
  appState: RuntimeAppState
  controlMode: ControlMode
  installationId: string
  reachability: Reachability
}>

export type CapabilityInvocation = Readonly<{
  caller: LocalCommand['caller']
  commandId: string
  createdAt: string
  expiresAt: string
}>

export type ConfirmationDetail = Readonly<{
  label: string
  value: string
}>

export type CapabilityExecutionLimits = Readonly<{
  maxResultBytes: number
  rate: Readonly<{
    maxGlobal: number
    maxPerCaller: number
    windowSeconds: number
  }>
}>

export type CapabilityDescriptor = Readonly<{
  confirmation: Confirmation
  description: string
  effect: Effect
  limits: CapabilityExecutionLimits
  path: string
  queuePolicy: QueuePolicy
  risk: Risk
  tool: string
}>

export interface MobileCapability<Arguments, Result> {
  readonly descriptor: CapabilityDescriptor
  readonly expose?: boolean
  readonly inputSchema: z.ZodType<Arguments>
  readonly outputSchema: z.ZodType<Result>
  confirmationDetails?(argumentsValue: Arguments): readonly ConfirmationDetail[]
  execute(
    argumentsValue: Arguments,
    context: CapabilityContext,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<Result>
  probe(context: CapabilityContext): Promise<CapabilityAvailability>
  preflight?(argumentsValue: Arguments): Promise<void> | void
}

export type CapabilitySnapshot = Readonly<{
  availability: CapabilityAvailability
  descriptor: CapabilityDescriptor
}>

export class ToolExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}
