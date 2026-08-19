import type {
  CapabilityAvailability,
  CapabilityContext,
  ConfirmationDetail,
  CapabilityDescriptor,
  CapabilityInvocation,
  CapabilitySnapshot,
  MobileCapability,
} from './types'
import type { z } from 'zod'


export type ArgumentParseResult =
  | Readonly<{ data: unknown; success: true }>
  | Readonly<{ issues: readonly z.core.$ZodIssue[]; success: false }>

export type RegisteredCapability = Readonly<{
  confirmationDetails(argumentsValue: unknown): readonly ConfirmationDetail[]
  descriptor: CapabilityDescriptor
  execute(
    argumentsValue: unknown,
    context: CapabilityContext,
    invocation: CapabilityInvocation,
    signal: AbortSignal,
  ): Promise<unknown>
  parse(argumentsValue: unknown): ArgumentParseResult
  probe(context: CapabilityContext): Promise<CapabilityAvailability>
  preflight(argumentsValue: unknown): Promise<void>
}>

function capabilityKey(path: string, tool: string): string {
  return `${path}\u0000${tool}`
}

export class CapabilityRegistry {
  readonly #capabilities = new Map<string, RegisteredCapability>()

  register<Arguments, Result>(capability: MobileCapability<Arguments, Result>): void {
    const { descriptor } = capability
    const { limits } = descriptor
    if (
      !Number.isSafeInteger(limits.maxResultBytes)
      || limits.maxResultBytes < 1
      || !Number.isSafeInteger(limits.rate.maxGlobal)
      || limits.rate.maxGlobal < 1
      || !Number.isSafeInteger(limits.rate.maxPerCaller)
      || limits.rate.maxPerCaller < 1
      || limits.rate.maxPerCaller > limits.rate.maxGlobal
      || !Number.isSafeInteger(limits.rate.windowSeconds)
      || limits.rate.windowSeconds < 1
    ) throw new Error(`能力 limits 无效: ${descriptor.path}.${descriptor.tool}`)
    const key = capabilityKey(descriptor.path, descriptor.tool)
    if (this.#capabilities.has(key)) {
      throw new Error(`能力重复注册: ${descriptor.path}.${descriptor.tool}`)
    }

    this.#capabilities.set(key, {
      confirmationDetails: argumentsValue => {
        const parsed = capability.inputSchema.parse(argumentsValue)
        return capability.confirmationDetails?.(parsed) ?? []
      },
      descriptor,
      execute: async (argumentsValue, context, invocation, signal) => {
        const parsed = capability.inputSchema.parse(argumentsValue)
        return capability.execute(parsed, context, invocation, signal)
      },
      parse: argumentsValue => {
        const parsed = capability.inputSchema.safeParse(argumentsValue)
        if (parsed.success) return { data: parsed.data, success: true }
        return { issues: parsed.error.issues, success: false }
      },
      probe: async context => {
        try {
          return await capability.probe(context)
        } catch {
          return { reason: 'probe_failed', status: 'unavailable' }
        }
      },
      preflight: async argumentsValue => {
        const parsed = capability.inputSchema.parse(argumentsValue)
        await capability.preflight?.(parsed)
      },
    })
  }

  resolve(path: string, tool: string): RegisteredCapability | null {
    return this.#capabilities.get(capabilityKey(path, tool)) ?? null
  }

  async snapshot(context: CapabilityContext): Promise<readonly CapabilitySnapshot[]> {
    return Promise.all(
      [...this.#capabilities.values()].map(async capability => ({
        availability: await capability.probe(context),
        descriptor: capability.descriptor,
      })),
    )
  }
}
