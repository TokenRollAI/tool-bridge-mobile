import { z } from 'zod'

import { CapabilityRegistry } from '@/capabilities/registry'
import { PolicyEngine } from '@/policy/policyEngine'

import {
  createRuntimeCancelCapability,
  createRuntimeCapabilitiesCapability,
  createRuntimePendingCommandsCapability,
} from '../runtimeCapabilities'


import type { CapabilityContext, CapabilityInvocation } from '@/capabilities/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_fixture',
  reachability: 'online',
}

const invocation: CapabilityInvocation = {
  caller: { subjectId: 'credential_principal_a' },
  commandId: 'runtime_query',
  createdAt: '2026-08-20T00:00:00.000Z',
  expiresAt: '2026-08-20T00:00:30.000Z',
}

describe('phone/runtime capabilities', () => {
  test('capabilities 返回 registry 的真实 availability 与安全 descriptor 投影', async () => {
    const registry = new CapabilityRegistry()
    const dependencies = {
      confirmationCoordinator: { getPending: () => [] },
      executor: {
        cancelForCaller: () => false,
        listActiveForCaller: () => [],
      },
      policyEngine: new PolicyEngine(),
      registry,
    }
    const capability = createRuntimeCapabilitiesCapability(
      dependencies,
      () => new Date('2026-08-20T00:00:01.000Z'),
    )
    registry.register(capability)

    await expect(capability.execute({}, context, invocation, new AbortController().signal))
      .resolves.toEqual({
        capabilities: [{
          availability: { status: 'available' },
          confirmation: 'never',
          description: capability.descriptor.description,
          effect: 'read',
          effectiveConfirmation: 'not_required',
          path: 'phone/runtime',
          risk: 'low',
          tool: 'capabilities',
        }],
        observedAt: '2026-08-20T00:00:01.000Z',
      })
  })

  test('effectiveConfirmation 随控制模式反映实际确认，而非只回显 descriptor.confirmation', async () => {
    // exec_shell 一类高特权工具 descriptor.confirmation 为 never，但在 ask_every_time 下仍会本地确认，
    // 在 direct_call 下才真正免确认。effectiveConfirmation 必须表达这一点，与 SDK expose 的 confirm 同源。
    const registry = new CapabilityRegistry()
    registry.register({
      descriptor: {
        confirmation: 'never' as const,
        description: 'privileged fixture',
        effect: 'destructive' as const,
        limits: { maxResultBytes: 1024, rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 } },
        path: 'phone/system',
        queuePolicy: 'reject_offline' as const,
        risk: 'high' as const,
        tool: 'exec_shell_fixture',
      },
      execute: async () => ({ ok: true }),
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ ok: z.boolean() }),
      probe: async () => ({ status: 'available' }),
    })
    const capability = createRuntimeCapabilitiesCapability({
      confirmationCoordinator: { getPending: () => [] },
      executor: { cancelForCaller: () => false, listActiveForCaller: () => [] },
      policyEngine: new PolicyEngine(),
      registry,
    }, () => new Date('2026-08-20T00:00:01.000Z'))

    const asked = await capability.execute({}, context, invocation, new AbortController().signal)
    expect(asked.capabilities).toContainEqual(expect.objectContaining({
      confirmation: 'never',
      effectiveConfirmation: 'required',
      tool: 'exec_shell_fixture',
    }))

    const direct = await capability.execute(
      {},
      { ...context, controlMode: 'direct_call' },
      invocation,
      new AbortController().signal,
    )
    expect(direct.capabilities).toContainEqual(expect.objectContaining({
      confirmation: 'never',
      effectiveConfirmation: 'not_required',
      tool: 'exec_shell_fixture',
    }))
  })

  test('pending_commands 只返回当前 credential principal，并标识等待本地确认的命令', async () => {
    const listActiveForCaller = jest.fn(() => [{
      callerSubjectId: 'credential_principal_a',
      commandId: 'pending_a',
      createdAt: '2026-08-20T00:00:00.000Z',
      expiresAt: '2026-08-20T00:00:30.000Z',
      path: 'phone/productivity',
      tool: 'notify',
    }])
    const capability = createRuntimePendingCommandsCapability({
      confirmationCoordinator: {
        getPending: () => [{
          callerDisplayName: null,
          callerSubjectId: 'credential_principal_a',
          commandId: 'pending_a',
          description: 'fixture',
          details: [],
          effect: 'write',
          expiresAt: '2026-08-20T00:00:30.000Z',
          path: 'phone/productivity',
          risk: 'medium',
          tool: 'notify',
        }, {
          callerDisplayName: null,
          callerSubjectId: 'credential_principal_b',
          commandId: 'other_principal',
          description: 'fixture',
          details: [],
          effect: 'write',
          expiresAt: '2026-08-20T00:00:30.000Z',
          path: 'phone/productivity',
          risk: 'medium',
          tool: 'notify',
        }],
      },
      executor: { cancelForCaller: () => false, listActiveForCaller },
      policyEngine: new PolicyEngine(),
      registry: new CapabilityRegistry(),
    })

    await expect(capability.execute({}, context, invocation, new AbortController().signal))
      .resolves.toEqual({
        commands: [{
          commandId: 'pending_a',
          createdAt: '2026-08-20T00:00:00.000Z',
          expiresAt: '2026-08-20T00:00:30.000Z',
          path: 'phone/productivity',
          state: 'awaiting_user',
          tool: 'notify',
        }],
        identityScope: 'gateway_credential_principal',
      })
    expect(listActiveForCaller).toHaveBeenCalledWith(
      'credential_principal_a',
      'runtime_query',
    )
  })

  test('cancel 只把当前 principal 的目标交给 executor，不虚报已经取消', async () => {
    const cancelForCaller = jest.fn(() => true)
    const capability = createRuntimeCancelCapability({
      confirmationCoordinator: { getPending: () => [] },
      executor: { cancelForCaller, listActiveForCaller: () => [] },
      policyEngine: new PolicyEngine(),
      registry: new CapabilityRegistry(),
    })

    await expect(capability.execute(
      { commandId: 'target_command' },
      context,
      invocation,
      new AbortController().signal,
    )).resolves.toEqual({
      commandId: 'target_command',
      status: 'cancellation_requested',
    })
    expect(cancelForCaller).toHaveBeenCalledWith(
      'target_command',
      'credential_principal_a',
    )
  })
})
