import { AttentionRateLimiter } from '../rateLimiter'

describe('AttentionRateLimiter', () => {
  test('同时限制单调用方和设备全局窗口，并在窗口后恢复', () => {
    let now = 1_000
    const limiter = new AttentionRateLimiter({
      clock: () => now,
      maxGlobal: 4,
      maxPerCaller: 2,
      windowMs: 60_000,
    })

    expect(limiter.consume('caller_a')).toEqual({ allowed: true })
    expect(limiter.consume('caller_a')).toEqual({ allowed: true })
    expect(limiter.consume('caller_a')).toEqual({ allowed: false, retryAfterMs: 60_000 })
    expect(limiter.consume('caller_b')).toEqual({ allowed: true })
    expect(limiter.consume('caller_b')).toEqual({ allowed: true })
    expect(limiter.consume('caller_c')).toEqual({ allowed: false, retryAfterMs: 60_000 })

    now += 60_000
    expect(limiter.consume('caller_a')).toEqual({ allowed: true })
  })
})
