import { PolicyEngine } from '../policyEngine'

import type { CapabilityContext, CapabilityDescriptor } from '@/capabilities/types'


const baseDescriptor: CapabilityDescriptor = {
  confirmation: 'never',
  description: 'test',
  effect: 'read',
  limits: {
    maxResultBytes: 1_024,
    rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
  },
  path: 'phone/status',
  queuePolicy: 'reject_offline',
  risk: 'low',
  tool: 'get',
}

const baseContext: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

describe('PolicyEngine', () => {
  const engine = new PolicyEngine()

  test('Disabled 在 handler 之前拒绝所有工具', () => {
    expect(engine.authorize(baseDescriptor, { ...baseContext, controlMode: 'disabled' }))
      .toMatchObject({ code: 'disabled', kind: 'reject' })
  })

  test('Ask every time 允许低风险读取，写入进入本地确认', () => {
    expect(engine.authorize(baseDescriptor, baseContext)).toEqual({ kind: 'allow' })
    expect(engine.authorize({ ...baseDescriptor, effect: 'write' }, baseContext))
      .toEqual({ kind: 'awaiting_user', reason: 'ask_every_time' })
  })

  test('高风险能力即使 trusted session 也不能静默执行', () => {
    expect(engine.authorize(
      { ...baseDescriptor, risk: 'high' },
      { ...baseContext, controlMode: 'trusted_session' },
    )).toEqual({ kind: 'awaiting_user', reason: 'local_confirmation_required' })
  })

  test('单命令本地批准只绕过确认，不能绕过 Disabled', () => {
    const descriptor = { ...baseDescriptor, effect: 'write' as const, risk: 'high' as const }
    expect(engine.authorize(descriptor, baseContext, { locallyApproved: true }))
      .toEqual({ kind: 'allow' })
    expect(engine.authorize(
      descriptor,
      { ...baseContext, controlMode: 'disabled' },
      { locallyApproved: true },
    )).toMatchObject({ code: 'disabled', kind: 'reject' })
  })
})
