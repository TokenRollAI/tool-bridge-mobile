import type { CapabilityDescriptor } from '@/capabilities/types'

export type AdmissionDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterMs: number }>

type AdmissionControllerOptions = Readonly<{
  maximumCallerKeys?: number
}>

export class LocalAdmissionController {
  readonly #callerAttempts = new Map<string, number[]>()
  readonly #globalAttempts = new Map<string, number[]>()
  readonly #maximumCallerKeys: number

  constructor(options: AdmissionControllerOptions = {}) {
    this.#maximumCallerKeys = options.maximumCallerKeys ?? 1_024
  }

  consume(
    descriptor: CapabilityDescriptor,
    callerSubjectId: string,
    nowMs: number,
  ): AdmissionDecision {
    const capabilityKey = `${descriptor.path}\u0000${descriptor.tool}`
    const callerKey = `${capabilityKey}\u0000${callerSubjectId}`
    const windowMs = descriptor.limits.rate.windowSeconds * 1_000
    this.#prune(nowMs)

    const callerAttempts = this.#callerAttempts.get(callerKey) ?? []
    const globalAttempts = this.#globalAttempts.get(capabilityKey) ?? []
    if (!this.#callerAttempts.has(callerKey) && this.#callerAttempts.size >= this.#maximumCallerKeys) {
      return { allowed: false, retryAfterMs: windowMs }
    }

    const callerRetryAfter = retryAfter(
      callerAttempts,
      descriptor.limits.rate.maxPerCaller,
      nowMs,
    )
    const globalRetryAfter = retryAfter(
      globalAttempts,
      descriptor.limits.rate.maxGlobal,
      nowMs,
    )
    if (callerRetryAfter > 0 || globalRetryAfter > 0) {
      return { allowed: false, retryAfterMs: Math.max(callerRetryAfter, globalRetryAfter) }
    }

    callerAttempts.push(nowMs + windowMs)
    globalAttempts.push(nowMs + windowMs)
    this.#callerAttempts.set(callerKey, callerAttempts)
    this.#globalAttempts.set(capabilityKey, globalAttempts)
    return { allowed: true }
  }

  #prune(nowMs: number): void {
    for (const attempts of [this.#callerAttempts, this.#globalAttempts]) {
      for (const [key, timestamps] of attempts) {
        const retained = timestamps.filter(expiresAt => expiresAt > nowMs)
        if (retained.length === 0) attempts.delete(key)
        else attempts.set(key, retained)
      }
    }
  }
}

function retryAfter(
  attempts: readonly number[],
  limit: number,
  nowMs: number,
): number {
  if (attempts.length < limit) return 0
  return Math.max(1, (attempts[0] ?? nowMs) - nowMs)
}
