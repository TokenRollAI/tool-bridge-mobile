import { appUrlArgumentsSchema } from './schema'

import type { AppHandoffController, AppUrlTarget } from './controller'
import type { AppUrlArguments } from './schema'
import type { CapabilityAvailability, MobileCapability } from '@/capabilities/types'

function probe(
  controller: AppHandoffController,
  appState: 'active' | 'background' | 'inactive' | 'unknown',
): CapabilityAvailability {
  if (!controller.hasConfiguredTarget()) {
    return { reason: 'link_hosts_unconfigured', status: 'unavailable' }
  }
  if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
  return controller.probe()
    ? { status: 'available' }
    : { reason: 'linking_module_unavailable', status: 'unavailable' }
}

export function createCanOpenUrlCapability(
  controller: AppHandoffController,
): MobileCapability<AppUrlArguments, Readonly<{ canOpen: boolean; target: AppUrlTarget }>> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '检查 allowlist 内的 HTTPS URL 是否可由系统处理',
      effect: 'read',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 60 },
      },
      path: 'phone/apps',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'can_open_url',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.canOpen(argumentsValue.url, signal, invocation.expiresAt)
    ),
    inputSchema: appUrlArgumentsSchema,
    preflight: argumentsValue => { controller.validate(argumentsValue.url) },
    probe: async context => probe(controller, context.appState),
  }
}

export function createOpenUrlCapability(
  controller: AppHandoffController,
): MobileCapability<AppUrlArguments, Readonly<{ status: 'handed_off'; target: AppUrlTarget }>> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '目标 hostname',
      value: controller.validate(argumentsValue.url).host,
    }],
    descriptor: {
      confirmation: 'when_locked',
      description: '把 allowlist 内的 HTTPS URL 交给用户可见的系统 App',
      effect: 'write',
      limits: {
        maxResultBytes: 4_096,
        rate: { maxGlobal: 20, maxPerCaller: 10, windowSeconds: 60 },
      },
      path: 'phone/apps',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'open_url',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.open(argumentsValue.url, signal, invocation.expiresAt)
    ),
    inputSchema: appUrlArgumentsSchema,
    preflight: argumentsValue => { controller.validate(argumentsValue.url) },
    probe: async context => probe(controller, context.appState),
  }
}
