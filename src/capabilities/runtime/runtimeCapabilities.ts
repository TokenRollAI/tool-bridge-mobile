import {
  runtimeCancelArgumentsSchema,
  runtimeCancelResultSchema,
  runtimeCapabilitiesResultSchema,
  runtimeEmptyArgumentsSchema,
  runtimePendingCommandsResultSchema,
} from './schema'

import type {
  RuntimeCancelArguments,
  RuntimeCancelResult,
  RuntimeCapabilitiesResult,
  RuntimePendingCommandsResult,
} from './schema'
import type { CapabilityRegistry } from '@/capabilities/registry'
import type { MobileCapability } from '@/capabilities/types'
import type { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import type { LocalCommandExecutor } from '@/runtime/localCommandExecutor'

type RuntimeCapabilityDependencies = Readonly<{
  confirmationCoordinator: Pick<LocalConfirmationCoordinator, 'getPending'>
  executor: Pick<LocalCommandExecutor, 'cancelForCaller' | 'listActiveForCaller'>
  registry: CapabilityRegistry
}>

const READ_LIMITS = {
  maxResultBytes: 32_768,
  rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
} as const

export function createRuntimeCapabilitiesCapability(
  dependencies: RuntimeCapabilityDependencies,
  clock: () => Date = () => new Date(),
): MobileCapability<Record<string, never>, RuntimeCapabilitiesResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取设备当前注册能力及其真实本地 availability；不代表后台或上游未交付能力',
      effect: 'read',
      limits: READ_LIMITS,
      path: 'phone/runtime',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'capabilities',
    },
    execute: async (_argumentsValue, context) => ({
      capabilities: (await dependencies.registry.snapshot(context)).map(item => ({
        availability: item.availability,
        confirmation: item.descriptor.confirmation,
        description: item.descriptor.description,
        effect: item.descriptor.effect,
        path: item.descriptor.path,
        risk: item.descriptor.risk,
        tool: item.descriptor.tool,
      })),
      observedAt: clock().toISOString(),
    }),
    inputSchema: runtimeEmptyArgumentsSchema,
    outputSchema: runtimeCapabilitiesResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}

export function createRuntimePendingCommandsCapability(
  dependencies: RuntimeCapabilityDependencies,
): MobileCapability<Record<string, never>, RuntimePendingCommandsResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取同一 gateway credential principal 当前仍在处理的命令元数据',
      effect: 'read',
      limits: READ_LIMITS,
      path: 'phone/runtime',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'pending_commands',
    },
    execute: async (_argumentsValue, _context, invocation) => {
      const awaitingUser = new Set(
        dependencies.confirmationCoordinator.getPending()
          .filter(item => item.callerSubjectId === invocation.caller.subjectId)
          .map(item => item.commandId),
      )
      return {
        commands: dependencies.executor.listActiveForCaller(
          invocation.caller.subjectId,
          invocation.commandId,
        ).map(command => ({
          commandId: command.commandId,
          createdAt: command.createdAt,
          expiresAt: command.expiresAt,
          path: command.path,
          state: awaitingUser.has(command.commandId) ? 'awaiting_user' as const : 'active' as const,
          tool: command.tool,
        })),
        identityScope: 'gateway_credential_principal' as const,
      }
    },
    inputSchema: runtimeEmptyArgumentsSchema,
    outputSchema: runtimePendingCommandsResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}

export function createRuntimeCancelCapability(
  dependencies: RuntimeCapabilityDependencies,
): MobileCapability<RuntimeCancelArguments, RuntimeCancelResult> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '目标 commandId',
      value: argumentsValue.commandId,
    }],
    descriptor: {
      confirmation: 'never',
      description: '请求取消同一 gateway credential principal 的本地活动命令',
      effect: 'write',
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/runtime',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'cancel',
    },
    execute: async (argumentsValue, _context, invocation) => ({
      commandId: argumentsValue.commandId,
      status: dependencies.executor.cancelForCaller(
        argumentsValue.commandId,
        invocation.caller.subjectId,
      ) ? 'cancellation_requested' : 'not_active',
    }),
    inputSchema: runtimeCancelArgumentsSchema,
    outputSchema: runtimeCancelResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}
