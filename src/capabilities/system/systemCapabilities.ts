import {
  accessibilityStatusArgumentsSchema,
  accessibilityStatusResultSchema,
  clipboardGetArgumentsSchema,
  clipboardGetResultSchema,
  clipboardSetArgumentsSchema,
  clipboardSetResultSchema,
  execShellArgumentsSchema,
  execShellResultSchema,
  openIntentArgumentsSchema,
  openIntentResultSchema,
} from './schema'

import type {
  AccessibilityStatusArguments,
  AccessibilityStatusResult,
  ClipboardGetArguments,
  ClipboardGetResult,
  ClipboardSetArguments,
  ClipboardSetResult,
  ExecShellArguments,
  ExecShellResult,
  OpenIntentArguments,
  OpenIntentResult,
} from './schema'
import type { SystemAdapter } from './systemAdapter'
import type { MobileCapability } from '@/capabilities/types'

const SYSTEM_PATH = 'phone/system'
// shell 结果 inline 上限 (~48 KiB)，与原生截断上限保持一致，避免超限后仍写入大结果。
const SHELL_MAX_OUTPUT_BYTES = 48 * 1024
const DEFAULT_SHELL_TIMEOUT_MS = 15_000

// 这些能力仅在 direct_call / trusted_session 下由 policy 放行。
// exec_shell 以 App 进程运行，后台也可用；clipboard 与 open_intent 保留前台门禁，因为
// Android 10+ 限制后台读剪贴板、也限制后台启动 Activity，后台执行会被系统拒绝而非成功。
// 高特权工具默认 confirmation:never，让“允许直接调用”模式真正免确认；模式本身即用户授权。

export function createExecShellCapability(
  adapter: SystemAdapter,
): MobileCapability<ExecShellArguments, ExecShellResult> {
  return {
    confirmationDetails: argumentsValue => [{ label: '命令', value: argumentsValue.command }],
    descriptor: {
      confirmation: 'never',
      description: '以 App 自身权限在设备上执行一条 shell 命令并返回 stdout/stderr/exitCode（不获取 root）',
      effect: 'destructive',
      limits: {
        maxResultBytes: 64 * 1024,
        rate: { maxGlobal: 30, maxPerCaller: 20, windowSeconds: 60 },
      },
      path: SYSTEM_PATH,
      queuePolicy: 'reject_offline',
      risk: 'high',
      tool: 'exec_shell',
    },
    execute: async argumentsValue => adapter.execShell(
      argumentsValue.command,
      argumentsValue.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS,
      SHELL_MAX_OUTPUT_BYTES,
    ),
    inputSchema: execShellArgumentsSchema,
    outputSchema: execShellResultSchema,
    // shell 以 App 自身进程执行，不依赖前台 UI，因此后台也可用（进程存活时）。
    probe: async () => ({ status: 'available' }),
  }
}

export function createClipboardGetCapability(
  adapter: SystemAdapter,
): MobileCapability<ClipboardGetArguments, ClipboardGetResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取系统剪贴板当前文本内容',
      effect: 'read',
      limits: {
        maxResultBytes: 68 * 1024,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 60 },
      },
      path: SYSTEM_PATH,
      queuePolicy: 'reject_offline',
      risk: 'high',
      tool: 'clipboard_get',
    },
    execute: async () => ({ text: await adapter.getClipboard() }),
    inputSchema: clipboardGetArgumentsSchema,
    outputSchema: clipboardGetResultSchema,
    probe: async context => (context.appState === 'active'
      ? { status: 'available' }
      : { reason: 'foreground_required', status: 'unavailable' }),
  }
}

export function createClipboardSetCapability(
  adapter: SystemAdapter,
): MobileCapability<ClipboardSetArguments, ClipboardSetResult> {
  return {
    confirmationDetails: () => [{ label: '操作', value: '写入系统剪贴板' }],
    descriptor: {
      confirmation: 'never',
      description: '把指定文本写入系统剪贴板',
      effect: 'write',
      limits: {
        maxResultBytes: 1_024,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 60 },
      },
      path: SYSTEM_PATH,
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'clipboard_set',
    },
    execute: async argumentsValue => {
      await adapter.setClipboard(argumentsValue.text)
      return { status: 'set' as const }
    },
    inputSchema: clipboardSetArgumentsSchema,
    outputSchema: clipboardSetResultSchema,
    probe: async context => (context.appState === 'active'
      ? { status: 'available' }
      : { reason: 'foreground_required', status: 'unavailable' }),
  }
}

export function createOpenIntentCapability(
  adapter: SystemAdapter,
): MobileCapability<OpenIntentArguments, OpenIntentResult> {
  return {
    confirmationDetails: argumentsValue => [{ label: 'URL', value: argumentsValue.url }],
    descriptor: {
      confirmation: 'never',
      description: '通过系统打开任意 URL 或自定义 scheme/Intent；成功仅表示系统接受 handoff',
      effect: 'write',
      limits: {
        maxResultBytes: 1_024,
        rate: { maxGlobal: 30, maxPerCaller: 20, windowSeconds: 60 },
      },
      path: SYSTEM_PATH,
      queuePolicy: 'reject_offline',
      risk: 'high',
      tool: 'open_intent',
    },
    execute: async argumentsValue => {
      await adapter.openUrl(argumentsValue.url)
      return { status: 'handed_off' as const }
    },
    inputSchema: openIntentArgumentsSchema,
    outputSchema: openIntentResultSchema,
    probe: async context => (context.appState === 'active'
      ? { status: 'available' }
      : { reason: 'foreground_required', status: 'unavailable' }),
  }
}

export function createAccessibilityStatusCapability(
  adapter: SystemAdapter,
): MobileCapability<AccessibilityStatusArguments, AccessibilityStatusResult> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取设备是否已开启无障碍服务（UI 自动化前置条件）',
      effect: 'read',
      limits: {
        maxResultBytes: 1_024,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 60 },
      },
      path: SYSTEM_PATH,
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'accessibility_status',
    },
    execute: async () => ({ enabled: await adapter.probeAccessibility() }),
    inputSchema: accessibilityStatusArgumentsSchema,
    outputSchema: accessibilityStatusResultSchema,
    probe: async () => ({ status: 'available' }),
  }
}
