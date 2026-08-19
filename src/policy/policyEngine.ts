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
