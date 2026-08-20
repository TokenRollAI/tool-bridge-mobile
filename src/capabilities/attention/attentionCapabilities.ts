import { ToolExecutionError } from '@/capabilities/types'

import { AttentionRateLimiter } from './rateLimiter'
import {
  ringArgumentsSchema,
  ringResultSchema,
  stopArgumentsSchema,
  stopResultSchema,
} from './schema'

import type { AttentionSessionController } from './controller'
import type { RingArguments, RingResult, StopArguments, StopResult } from './schema'
import type { MobileCapability } from '@/capabilities/types'

export function createAttentionRingCapability(
  controller: AttentionSessionController,
  rateLimiter = new AttentionRateLimiter(),
): MobileCapability<RingArguments, RingResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '持续时间',
      value: `${argumentsValue.durationSeconds} 秒`,
    }],
    descriptor: {
      confirmation: 'when_locked',
      description: '在前台设备上播放内置提示音，并可请求 haptic 与闪光灯',
      effect: 'write',
      limits: {
        maxResultBytes: 8_192,
        rate: { maxGlobal: 6, maxPerCaller: 3, windowSeconds: 60 },
      },
      path: 'phone/attention',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'ring',
    },
    execute: async (argumentsValue, _context, invocation, signal) => {
      const rateLimit = rateLimiter.consume(invocation.caller.subjectId)
      if (!rateLimit.allowed) {
        throw new ToolExecutionError(
          'rate_limited',
          `attention 调用过于频繁，请在 ${rateLimit.retryAfterMs}ms 后重试`,
          true,
        )
      }
      return controller.start(
        argumentsValue,
        invocation.caller.subjectId,
        signal,
        invocation.expiresAt,
      )
    },
    inputSchema: ringArgumentsSchema,
    outputSchema: ringResultSchema,
    probe: async context => {
      if (context.appState !== 'active') {
        return { reason: 'foreground_required', status: 'unavailable' }
      }
      const channels = await controller.probeChannels()
      return channels.haptics || channels.sound || channels.flash
        ? { status: 'available' }
        : { reason: 'attention_channels_unavailable', status: 'unavailable' }
    },
  }
}

export function createAttentionStopCapability(
  controller: AttentionSessionController,
): MobileCapability<StopArguments, StopResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '停止当前本地 attention session；设备本地停止入口始终优先',
      effect: 'write',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/attention',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'stop',
    },
    execute: async argumentsValue => {
      const result = await controller.stop(argumentsValue.sessionId)
      if (result.status === 'not_active') {
        throw new ToolExecutionError('not_found', '指定 attention session 不在运行', false)
      }
      return result
    },
    inputSchema: stopArgumentsSchema,
    outputSchema: stopResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}
