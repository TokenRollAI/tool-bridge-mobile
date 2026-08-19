import type { CapabilityContext, CapabilityDescriptor } from '@/capabilities/types'

export type PolicyDecision =
  | Readonly<{ kind: 'allow' }>
  | Readonly<{ code: string; kind: 'reject'; message: string; retryable: boolean }>
  | Readonly<{ kind: 'awaiting_user'; reason: string }>

export class PolicyEngine {
  authorize(
    descriptor: CapabilityDescriptor,
    context: CapabilityContext,
    approval: Readonly<{ locallyApproved?: boolean }> = {},
  ): PolicyDecision {
    if (context.controlMode === 'disabled') {
      return {
        code: 'disabled',
        kind: 'reject',
        message: '用户已在设备上停用远程能力',
        retryable: false,
      }
    }

    // direct_call 是用户在设备本地明确选择的“允许直接调用”模式：除紧急停用外，
    // 所有能力（含 high risk / confirmation:always）都不再逐次确认。系统权限、
    // 前后台/锁屏状态和 native probe 仍是各能力自身的最终裁决，这里只放开策略层确认。
    if (context.controlMode === 'direct_call') {
      return { kind: 'allow' }
    }

    if (
      approval.locallyApproved !== true
      && (descriptor.risk === 'high' || descriptor.confirmation === 'always')
    ) {
      return { kind: 'awaiting_user', reason: 'local_confirmation_required' }
    }

    if (
      approval.locallyApproved !== true
      && descriptor.confirmation === 'when_locked'
      && context.appState !== 'active'
    ) {
      return { kind: 'awaiting_user', reason: 'foreground_confirmation_required' }
    }

    if (
      approval.locallyApproved !== true
      && context.controlMode === 'ask_every_time'
      && descriptor.effect !== 'read'
    ) {
      return { kind: 'awaiting_user', reason: 'ask_every_time' }
    }

    return { kind: 'allow' }
  }
}
