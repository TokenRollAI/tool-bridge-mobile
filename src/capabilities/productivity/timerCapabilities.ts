import {
  timerReferenceArgumentsSchema,
  timerCancelResultSchema,
  timerStartArgumentsSchema,
  timerStartResultSchema,
  timerStatusResultSchema,
} from './timerSchema'

import type {
  LocalTimerController,
  TimerCancelResult,
  TimerStartResult,
  TimerStatusResult,
} from './timerController'
import type { TimerReferenceArguments, TimerStartArguments } from './timerSchema'
import type { MobileCapability } from '@/capabilities/types'

const CONTROL_LIMITS = {
  maxResultBytes: 2_048,
  rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
} as const

export function createTimerStartCapability(
  controller: LocalTimerController,
): MobileCapability<TimerStartArguments, TimerStartResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '用途',
      value: argumentsValue.purpose,
    }, {
      label: '目标时间',
      value: argumentsValue.firesAt,
    }],
    descriptor: {
      confirmation: 'when_locked',
      description: '创建由 SQLite 跟踪、由系统 best-effort 提示的单次 App 内计时器',
      effect: 'write',
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
      },
      path: 'phone/productivity',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'timer_start',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.start(argumentsValue, invocation, signal)
    ),
    inputSchema: timerStartArgumentsSchema,
    outputSchema: timerStartResultSchema,
    preflight: argumentsValue => { controller.validateStart(argumentsValue.firesAt) },
    probe: context => controller.probeStart(context.appState),
  }
}

export function createTimerCancelCapability(
  controller: LocalTimerController,
): MobileCapability<TimerReferenceArguments, TimerCancelResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '取消同一调用方创建的 App 内计时器并清理系统提示',
      effect: 'write',
      limits: CONTROL_LIMITS,
      path: 'phone/productivity',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'timer_cancel',
    },
    execute: (argumentsValue, _context, invocation) => (
      controller.cancelForCaller(argumentsValue.timerId, invocation.caller.subjectId)
    ),
    inputSchema: timerReferenceArgumentsSchema,
    outputSchema: timerCancelResultSchema,
    probe: () => controller.probeControl(),
  }
}

export function createTimerStatusCapability(
  controller: LocalTimerController,
): MobileCapability<TimerReferenceArguments, TimerStatusResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取同一调用方创建的 App 内计时器状态，不推断呈现或送达',
      effect: 'read',
      limits: CONTROL_LIMITS,
      path: 'phone/productivity',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'timer_status',
    },
    execute: (argumentsValue, _context, invocation) => (
      controller.status(argumentsValue.timerId, invocation.caller.subjectId)
    ),
    inputSchema: timerReferenceArgumentsSchema,
    outputSchema: timerStatusResultSchema,
    probe: () => controller.probeControl(),
  }
}
