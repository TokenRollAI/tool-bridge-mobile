import { createReactNativeAbortSignal } from '@/testFixtures/reactNativeAbortSignal'

import { createAttentionRingCapability } from '../attentionCapabilities'
import { AttentionSessionController } from '../controller'
import { AttentionRateLimiter } from '../rateLimiter'
import { ringArgumentsSchema } from '../schema'

import type { AttentionFlashAdapter } from '../flashAdapter'
import type { AttentionHapticsAdapter } from '../hapticsAdapter'
import type { AttentionSoundAdapter } from '../soundAdapter'
import type { CapabilityContext } from '@/capabilities/types'

function createHaptics(available = true) {
  let cancelled = 0
  let pulses = 0
  const adapter: AttentionHapticsAdapter = {
    cancel: async () => { cancelled += 1 },
    probe: async () => available,
    pulse: async () => {
      pulses += 1
      return available
    },
  }
  return { adapter, cancelled: () => cancelled, pulses: () => pulses }
}

function createFlash(available = true, enableResult = available) {
  let disabled = 0
  let enabled = 0
  const adapter: AttentionFlashAdapter = {
    disable: async () => { disabled += 1 },
    enable: async () => {
      enabled += 1
      return enableResult
    },
    probe: async () => available,
  }
  return { adapter, disabled: () => disabled, enabled: () => enabled }
}

const activeContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'trusted_session',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

describe('AttentionSessionController', () => {
  afterEach(() => jest.useRealTimers())

  test('只调度可探测 haptic，并诚实报告未实现通道', async () => {
    jest.useFakeTimers()
    const haptics = createHaptics()
    const controller = new AttentionSessionController(haptics.adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      idGenerator: () => '00000000-0000-4000-8000-000000000001',
      pulseIntervalMs: 1_000,
    })
    const signal = createReactNativeAbortSignal()
    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 3 }),
      'caller_a',
      signal,
    )

    expect(result).toMatchObject({
      channels: {
        flash: { status: 'unavailable' },
        sound: { status: 'unavailable' },
        vibration: { status: 'requested' },
      },
      expiresAt: '2026-08-19T00:00:03.000Z',
      sessionId: 'attention_00000000-0000-4000-8000-000000000001',
    })
    expect(haptics.pulses()).toBe(1)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(haptics.pulses()).toBe(2)
    await controller.stop(result.sessionId)
    await jest.advanceTimersByTimeAsync(3_000)
    expect(haptics.pulses()).toBe(2)
    expect(haptics.cancelled()).toBe(1)
  })

  test('后台或 native probe 失败时 capability 明确 unavailable', async () => {
    const unavailable = createAttentionRingCapability(
      new AttentionSessionController(createHaptics(false).adapter),
    )
    await expect(unavailable.probe(activeContext)).resolves.toEqual({
      reason: 'attention_channels_unavailable',
      status: 'unavailable',
    })

    const available = createAttentionRingCapability(
      new AttentionSessionController(createHaptics().adapter),
    )
    await expect(available.probe({ ...activeContext, appState: 'background' })).resolves.toEqual({
      reason: 'foreground_required',
      status: 'unavailable',
    })
  })

  test('haptic 不可用时仍可真实请求内置提示音，并在 stop 时释放', async () => {
    let starts = 0
    let stops = 0
    const sound: AttentionSoundAdapter = {
      probe: async () => true,
      start: async () => { starts += 1; return true },
      stop: async () => { stops += 1 },
    }
    const controller = new AttentionSessionController(createHaptics(false).adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      idGenerator: () => 'sound-only-fixture',
      sound,
    })

    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 3, vibrate: false }),
      'caller_a',
      new AbortController().signal,
    )
    expect(result.channels).toEqual({
      flash: { reason: 'not_requested', status: 'unavailable' },
      sound: { status: 'requested' },
      vibration: { reason: 'not_requested', status: 'unavailable' },
    })
    expect(starts).toBe(1)
    await controller.stop(result.sessionId)
    expect(stops).toBe(1)
  })

  test('请求闪光灯且硬件可用时点亮 torch，并在 stop 时释放', async () => {
    const flash = createFlash()
    const controller = new AttentionSessionController(createHaptics(false).adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      flash: flash.adapter,
      idGenerator: () => 'flash-fixture',
    })

    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 3, flash: true, vibrate: false }),
      'caller_a',
      new AbortController().signal,
    )

    expect(result.channels.flash).toEqual({ status: 'requested' })
    expect(flash.enabled()).toBe(1)
    await controller.stop(result.sessionId)
    expect(flash.disabled()).toBe(1)
  })

  test('请求闪光灯但无硬件时诚实返回 unavailable，不假装点亮', async () => {
    const flash = createFlash(false)
    const controller = new AttentionSessionController(createHaptics().adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      flash: flash.adapter,
      idGenerator: () => 'flash-unavailable-fixture',
    })

    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 3, flash: true }),
      'caller_a',
      new AbortController().signal,
    )

    expect(result.channels.flash).toEqual({ reason: 'flash_unavailable', status: 'unavailable' })
    expect(flash.enabled()).toBe(0)
  })

  test('仅闪光灯可用时也能建立会话并在到期释放 torch', async () => {
    jest.useFakeTimers()
    const flash = createFlash()
    const controller = new AttentionSessionController(createHaptics(false).adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      flash: flash.adapter,
      idGenerator: () => 'flash-only-fixture',
    })

    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 2, flash: true, vibrate: false }),
      'caller_a',
      new AbortController().signal,
    )
    expect(result.channels).toEqual({
      flash: { status: 'requested' },
      sound: { reason: 'sound_unavailable', status: 'unavailable' },
      vibration: { reason: 'not_requested', status: 'unavailable' },
    })
    await jest.advanceTimersByTimeAsync(2_000)
    expect(flash.disabled()).toBe(1)
  })

  test('TTL 到期自动停止并取消后续 pulse', async () => {
    jest.useFakeTimers()
    const haptics = createHaptics()
    const controller = new AttentionSessionController(haptics.adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      idGenerator: () => 'expiry-fixture',
      pulseIntervalMs: 750,
    })

    await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 2 }),
      'caller_a',
      new AbortController().signal,
    )
    await jest.advanceTimersByTimeAsync(2_000)
    expect(haptics.cancelled()).toBe(1)
    const pulsesAtExpiry = haptics.pulses()
    await jest.advanceTimersByTimeAsync(2_000)
    expect(haptics.pulses()).toBe(pulsesAtExpiry)
    await expect(controller.stop()).resolves.toEqual({ sessionId: null, status: 'not_active' })
  })

  test('command deadline 早于请求时长时按更早期限停止', async () => {
    jest.useFakeTimers()
    const haptics = createHaptics()
    const controller = new AttentionSessionController(haptics.adapter, {
      clock: () => new Date('2026-08-19T00:00:00.000Z'),
      idGenerator: () => 'command-deadline-fixture',
      pulseIntervalMs: 750,
    })

    const result = await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 120 }),
      'caller_a',
      new AbortController().signal,
      '2026-08-19T00:00:02.000Z',
    )
    expect(result.expiresAt).toBe('2026-08-19T00:00:02.000Z')
    await jest.advanceTimersByTimeAsync(2_000)
    expect(haptics.cancelled()).toBe(1)
    const pulsesAtDeadline = haptics.pulses()
    await jest.advanceTimersByTimeAsync(2_000)
    expect(haptics.pulses()).toBe(pulsesAtDeadline)
  })

  test('ring capability 在 handler 前按 caller 执行限流', async () => {
    const controller = new AttentionSessionController(createHaptics().adapter, {
      clock: () => new Date('2026-08-19T00:00:30.000Z'),
      idGenerator: () => 'rate-limit-fixture',
    })
    const capability = createAttentionRingCapability(controller, new AttentionRateLimiter({
      maxGlobal: 2,
      maxPerCaller: 1,
    }))
    const argumentsValue = ringArgumentsSchema.parse({ durationSeconds: 30 })
    const signal = new AbortController().signal
    await capability.execute(argumentsValue, activeContext, {
      caller: { subjectId: 'caller_a' },
      commandId: 'command_1',
      createdAt: '2026-08-19T00:00:00.000Z',
      expiresAt: '2026-08-19T00:01:00.000Z',
    }, signal)
    await controller.stop()

    await expect(capability.execute(argumentsValue, activeContext, {
      caller: { subjectId: 'caller_a' },
      commandId: 'command_2',
      createdAt: '2026-08-19T00:00:01.000Z',
      expiresAt: '2026-08-19T00:01:00.000Z',
    }, signal)).rejects.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  test('AbortSignal 取消活动 session，之后不再 pulse', async () => {
    jest.useFakeTimers()
    const haptics = createHaptics()
    const controller = new AttentionSessionController(haptics.adapter, {
      idGenerator: () => 'cancel-fixture',
      pulseIntervalMs: 1_000,
    })
    const abortController = new AbortController()
    await controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 30 }),
      'caller_a',
      abortController.signal,
    )

    abortController.abort()
    await jest.advanceTimersByTimeAsync(0)
    expect(haptics.cancelled()).toBe(1)
    expect(controller.getActiveSession()).toBeNull()
    const pulsesAtCancellation = haptics.pulses()
    await jest.advanceTimersByTimeAsync(2_000)
    expect(haptics.pulses()).toBe(pulsesAtCancellation)
  })

  test('首次 pulse 等待期间取消会立即停止已请求的 haptic', async () => {
    const abortController = new AbortController()
    let cancelled = 0
    const controller = new AttentionSessionController({
      cancel: async () => { cancelled += 1 },
      probe: async () => true,
      pulse: async () => {
        abortController.abort()
        return true
      },
    })

    await expect(controller.start(
      ringArgumentsSchema.parse({ durationSeconds: 30 }),
      'caller_a',
      abortController.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toBe(1)
    expect(controller.getActiveSession()).toBeNull()
  })

  test('schema 拒绝超时长、超长 message、控制字符和未知字段', () => {
    expect(ringArgumentsSchema.safeParse({ durationSeconds: 121 }).success).toBe(false)
    expect(ringArgumentsSchema.safeParse({ message: 'x'.repeat(121) }).success).toBe(false)
    expect(ringArgumentsSchema.safeParse({ message: 'fake\nsystem' }).success).toBe(false)
    expect(ringArgumentsSchema.safeParse({ message: '提示\u202e系统设置' }).success).toBe(false)
    expect(ringArgumentsSchema.safeParse({ unexpected: true }).success).toBe(false)
  })
})
