export type RateLimitDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterMs: number }>

type AttentionRateLimiterOptions = Readonly<{
  clock?: () => number
  maxGlobal?: number
  maxPerCaller?: number
  windowMs?: number
}>

export class AttentionRateLimiter {
  readonly #clock: () => number
  readonly #maxGlobal: number
  readonly #maxPerCaller: number
  readonly #windowMs: number
  readonly #globalAttempts: number[] = []
  readonly #callerAttempts = new Map<string, number[]>()

  constructor(options: AttentionRateLimiterOptions = {}) {
    this.#clock = options.clock ?? Date.now
    this.#maxGlobal = options.maxGlobal ?? 6
    this.#maxPerCaller = options.maxPerCaller ?? 3
    this.#windowMs = options.windowMs ?? 60_000
  }

  consume(callerSubjectId: string): RateLimitDecision {
    const now = this.#clock()
    this.#trim(this.#globalAttempts, now)
    const callerAttempts = this.#callerAttempts.get(callerSubjectId) ?? []
    this.#trim(callerAttempts, now)

    const globalRetryAfter = this.#retryAfter(this.#globalAttempts, this.#maxGlobal, now)
    const callerRetryAfter = this.#retryAfter(callerAttempts, this.#maxPerCaller, now)
    const retryAfterMs = Math.max(globalRetryAfter, callerRetryAfter)
    if (retryAfterMs > 0) return { allowed: false, retryAfterMs }

    this.#globalAttempts.push(now)
    callerAttempts.push(now)
    this.#callerAttempts.set(callerSubjectId, callerAttempts)
    return { allowed: true }
  }

  #retryAfter(attempts: readonly number[], limit: number, now: number): number {
    if (attempts.length < limit) return 0
    const oldest = attempts[0]
    return oldest === undefined ? 0 : Math.max(1, oldest + this.#windowMs - now)
  }

  #trim(attempts: number[], now: number): void {
    while (attempts[0] !== undefined && attempts[0] + this.#windowMs <= now) attempts.shift()
  }
}
