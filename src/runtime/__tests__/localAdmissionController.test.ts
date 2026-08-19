import { LocalAdmissionController } from '../localAdmissionController'

import type { CapabilityDescriptor } from '@/capabilities/types'

const descriptor: CapabilityDescriptor = {
  confirmation: 'always',
  description: 'admission fixture',
  effect: 'write',
  limits: {
    maxResultBytes: 1_024,
    rate: { maxGlobal: 3, maxPerCaller: 2, windowSeconds: 60 },
  },
  path: 'phone/fixture',
  queuePolicy: 'reject_offline',
  risk: 'high',
  tool: 'run',
}

describe('LocalAdmissionController', () => {
  test('确认前同时执行 caller/global 滑动窗口限流并在窗口后恢复', () => {
    const controller = new LocalAdmissionController()
    expect(controller.consume(descriptor, 'caller_a', 0)).toEqual({ allowed: true })
    expect(controller.consume(descriptor, 'caller_a', 1)).toEqual({ allowed: true })
    expect(controller.consume(descriptor, 'caller_a', 2)).toEqual({
      allowed: false,
      retryAfterMs: 59_998,
    })
    expect(controller.consume(descriptor, 'caller_b', 2)).toEqual({ allowed: true })
    expect(controller.consume(descriptor, 'caller_c', 3)).toEqual({
      allowed: false,
      retryAfterMs: 59_997,
    })
    expect(controller.consume(descriptor, 'caller_a', 60_001)).toEqual({ allowed: true })
  })

  test('caller key 集合有硬上限，拒绝无限 subjectId 基数', () => {
    const controller = new LocalAdmissionController({ maximumCallerKeys: 1 })
    expect(controller.consume(descriptor, 'caller_a', 0)).toEqual({ allowed: true })
    expect(controller.consume(descriptor, 'caller_b', 1)).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    })
  })
})
