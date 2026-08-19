import {
  createAccessibilityStatusCapability,
  createClipboardGetCapability,
  createClipboardSetCapability,
  createExecShellCapability,
  createOpenIntentCapability,
} from '../systemCapabilities'

import type { ShellOutput, SystemAdapter } from '../systemAdapter'
import type { CapabilityContext, CapabilityInvocation } from '@/capabilities/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'direct_call',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'online',
}

const invocation: CapabilityInvocation = {
  caller: { subjectId: 'caller_a' },
  commandId: 'command_a',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T00:00:30.000Z',
}

function adapter(overrides: Partial<SystemAdapter> = {}): SystemAdapter {
  return {
    execShell: async (): Promise<ShellOutput> => (
      { exitCode: 0, stderr: '', stdout: 'ok', truncated: false }
    ),
    getClipboard: async () => 'copied',
    setClipboard: async () => {},
    probeAccessibility: async () => true,
    openUrl: async () => {},
    startBackgroundRuntime: async () => {},
    stopBackgroundRuntime: async () => {},
    ...overrides,
  }
}

const signal = new AbortController().signal

describe('phone/system capabilities', () => {
  test('exec_shell 是 destructive/high 并转发命令与默认 timeout', async () => {
    const execShell = jest.fn(async () => (
      { exitCode: 0, stderr: '', stdout: 'hi', truncated: false }
    ))
    const capability = createExecShellCapability(adapter({ execShell }))
    expect(capability.descriptor.effect).toBe('destructive')
    expect(capability.descriptor.risk).toBe('high')
    const result = await capability.execute({ command: 'echo hi' }, context, invocation, signal)
    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: 'hi', truncated: false })
    expect(execShell).toHaveBeenCalledWith('echo hi', 15_000, 48 * 1024)
  })

  test('exec_shell 后台仍可用（以 App 进程执行，不依赖前台 UI）', async () => {
    const capability = createExecShellCapability(adapter())
    await expect(capability.probe({ ...context, appState: 'background' }))
      .resolves.toEqual({ status: 'available' })
  })

  test('clipboard_set 后台不可用（Android 限制后台剪贴板与启动 Activity）', async () => {
    const capability = createClipboardSetCapability(adapter())
    await expect(capability.probe({ ...context, appState: 'background' }))
      .resolves.toEqual({ reason: 'foreground_required', status: 'unavailable' })
  })

  test('clipboard_get 读取文本，clipboard_set 回 set', async () => {
    const getCapability = createClipboardGetCapability(adapter())
    await expect(getCapability.execute({}, context, invocation, signal))
      .resolves.toEqual({ text: 'copied' })
    const setClipboard = jest.fn(async () => {})
    const setCapability = createClipboardSetCapability(adapter({ setClipboard }))
    await expect(setCapability.execute({ text: 'x' }, context, invocation, signal))
      .resolves.toEqual({ status: 'set' })
    expect(setClipboard).toHaveBeenCalledWith('x')
  })

  test('open_intent 转发 URL 并返回 handed_off', async () => {
    const openUrl = jest.fn(async () => {})
    const capability = createOpenIntentCapability(adapter({ openUrl }))
    await expect(capability.execute({ url: 'tel:123' }, context, invocation, signal))
      .resolves.toEqual({ status: 'handed_off' })
    expect(openUrl).toHaveBeenCalledWith('tel:123')
  })

  test('accessibility_status 是低风险只读并投影 enabled', async () => {
    const capability = createAccessibilityStatusCapability(adapter({ probeAccessibility: async () => false }))
    expect(capability.descriptor.effect).toBe('read')
    expect(capability.descriptor.risk).toBe('low')
    await expect(capability.execute({}, context, invocation, signal))
      .resolves.toEqual({ enabled: false })
  })
})
