import {
  decodeDeviceFrame,
  encodeDeviceFrame,
} from '@tool-bridge/sdk/device'
import { z } from 'zod'

import { CapabilityRegistry } from '@/capabilities/registry'
import {
  createSdkDeviceCallHandler,
  LOCAL_REALTIME_COMMAND_TTL_MS,
  SdkDeviceTransport,
} from '@/gateway/sdkDeviceTransport'

import type { MobileCapability } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'
import type {
  DeviceCredentialEnvelope,
  DeviceCredentialStore,
} from '@/identity/deviceCredentialStore'
import type {
  DeviceFrame,
  DeviceWebSocketFactory,
  DeviceWebSocketFactoryInput,
} from '@tool-bridge/sdk/device'

const credential: DeviceCredentialEnvelope = {
  audienceOrigin: 'https://gateway.example.com',
  deviceId: 'device_01',
  keyId: 'device_key_01',
  material: 'opaque-device-secret',
  version: 1,
}

class MemoryCredentialStore implements DeviceCredentialStore {
  constructor(public value: DeviceCredentialEnvelope | null) {}

  async clear(): Promise<void> {
    this.value = null
  }

  async get(): Promise<DeviceCredentialEnvelope | null> {
    return this.value
  }

  async save(value: DeviceCredentialEnvelope): Promise<void> {
    this.value = value
  }
}

class FakeRawWebSocket extends EventTarget {
  static readonly CLOSED = 3
  static readonly CLOSING = 2
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  binaryType = 'blob'
  readonly bufferedAmount = 0
  readonly extensions = ''
  readonly protocol = ''
  readyState = FakeRawWebSocket.CONNECTING
  readonly sent: string[] = []

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeRawWebSocket.CLOSED) return
    this.readyState = FakeRawWebSocket.CLOSED
    this.emitClose(code, reason)
  }

  emitClose(code: number, reason: string): void {
    const event = new Event('close')
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    })
    this.dispatchEvent(event)
  }

  open(): void {
    this.readyState = FakeRawWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(frame: DeviceFrame): void {
    this.dispatchEvent(new MessageEvent('message', { data: encodeDeviceFrame(frame) }))
  }

  send(data: string): void {
    this.sent.push(data)
  }
}

function createWebSocketHarness(): Readonly<{
  factory: DeviceWebSocketFactory
  inputs: DeviceWebSocketFactoryInput[]
  sockets: FakeRawWebSocket[]
}> {
  const inputs: DeviceWebSocketFactoryInput[] = []
  const sockets: FakeRawWebSocket[] = []
  return {
    inputs,
    sockets,
    factory: {
      open(input) {
        inputs.push(input)
        const socket = new FakeRawWebSocket()
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
    },
  }
}

function createRegistry(): CapabilityRegistry {
  const capability: MobileCapability<Record<string, never>, Readonly<{ status: 'ok' }>> = {
    descriptor: {
      confirmation: 'never',
      description: '读取 fixture 状态',
      effect: 'read',
      limits: {
        maxResultBytes: 1_024,
        rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
      },
      path: 'phone/fixture',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'get',
    },
    execute: async () => ({ status: 'ok' }),
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({ status: z.literal('ok') }),
    probe: async () => ({ status: 'available' }),
  }
  const registry = new CapabilityRegistry()
  registry.register(capability)
  return registry
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < 100; index += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }
  throw lastError
}

describe('@tool-bridge/sdk/device mobile adapter', () => {
  test('把官方 call 映射到有本地期限的 executor command，并把本地错误归一为 TBError', async () => {
    const commands: LocalCommand[] = []
    const handler = createSdkDeviceCallHandler({
      callerSubjectId: 'device_key_01',
      clock: () => new Date('2026-08-19T10:00:00.000Z'),
      executeCommand: async command => {
        commands.push(command)
        return { ok: true, value: { observed: true } }
      },
    })

    await expect(handler({
      arguments: {},
      id: 'call_01',
      path: 'phone/fixture',
      signal: new AbortController().signal,
      tool: 'get',
    })).resolves.toEqual({ observed: true })
    expect(commands).toEqual([expect.objectContaining({
      caller: { displayName: 'Tool Bridge 网关', subjectId: 'device_key_01' },
      commandId: 'call_01',
      createdAt: '2026-08-19T10:00:00.000Z',
      expiresAt: new Date(
        Date.parse('2026-08-19T10:00:00.000Z') + LOCAL_REALTIME_COMMAND_TTL_MS,
      ).toISOString(),
      path: 'phone/fixture',
      tool: 'get',
    })])

    const deniedHandler = createSdkDeviceCallHandler({
      callerSubjectId: 'device_key_01',
      executeCommand: async () => ({
        error: { code: 'disabled', message: '设备已停用', retryable: false },
        ok: false,
      }),
    })
    await expect(deniedHandler({
      arguments: {},
      id: 'call_02',
      path: 'phone/fixture',
      signal: new AbortController().signal,
      tool: 'get',
    })).rejects.toMatchObject({ code: 'permission_denied', retryable: false })
  })

  test('真实 SDK supervisor 使用 RN header、hello/ready/call/result，仅在 Disabled 时 suspend', async () => {
    const harness = createWebSocketHarness()
    const commands: LocalCommand[] = []
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      clock: () => new Date('2026-08-19T10:00:00.000Z'),
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async command => {
        commands.push(command)
        return { ok: true, value: { status: 'ok' } }
      },
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(harness.sockets).toHaveLength(1))
    expect(harness.inputs).toEqual([{
      headers: { authorization: 'Bearer opaque-device-secret' },
      url: 'wss://gateway.example.com/system/device/ws?deviceId=device_01',
    }])
    expect(harness.inputs[0]?.url).not.toContain(credential.material)

    const socket = harness.sockets[0]
    if (socket === undefined) throw new Error('missing SDK fixture WebSocket')
    socket.open()
    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toMatchObject({
      deviceId: 'device_01',
      expose: {
        nodes: [{
          cmds: [{ name: 'get' }],
          path: 'phone/fixture',
        }],
      },
      type: 'hello',
    })

    socket.receive({ type: 'ready', mountPath: 'device/device_01' })
    await eventually(() => expect(transport.getSnapshot()).toMatchObject({
      deviceId: 'device_01',
      gatewayOrigin: 'https://gateway.example.com',
      mountPath: 'device/device_01',
      state: 'ready',
    }))
    socket.sent.length = 0
    socket.receive({
      arguments: {},
      id: 'call_03',
      path: 'phone/fixture',
      tool: 'get',
      type: 'call',
    })
    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toEqual({
      id: 'call_03',
      ok: true,
      type: 'result',
      value: { status: 'ok' },
    })
    expect(commands).toHaveLength(1)

    // 后台不再断线：App 退到 background 时连接保持，命令仍可到达。
    await transport.updateLifecycle('background', true)
    expect(transport.getSnapshot().state).toBe('ready')
    expect(transport.getSnapshot().diagnostic).toBeNull()

    // inactive 是失焦、台前调度切换、通知中心下拉、来电弹窗等短暂过渡态。此前会 suspend，
    // 把每次失焦放大成一次断线重连；现在保持连接不再抖动。
    await transport.updateLifecycle('inactive', true)
    expect(transport.getSnapshot().state).toBe('ready')
    expect(transport.getSnapshot().diagnostic).toBeNull()

    // unknown（启动初值、罕见平台态）同样保持连接。
    await transport.updateLifecycle('unknown', true)
    expect(transport.getSnapshot().state).toBe('ready')

    // 只有 Disabled/紧急停用才无条件 suspend。
    await transport.updateLifecycle('background', false)
    expect(transport.getSnapshot().state).toBe('suspended')
    await transport.stopForLocalRevocation()
  })

  test('只把底层 WebSocket 原始失败映射成脱敏诊断，并在 ready 后清除', async () => {
    const harness = createWebSocketHarness()
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async () => ({ ok: true, value: null }),
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(harness.sockets).toHaveLength(1))
    const failedSocket = harness.sockets[0]
    if (failedSocket === undefined) throw new Error('missing failed SDK fixture WebSocket')
    failedSocket.open()
    failedSocket.close(1006, 'SSLHandshakeException: Bearer must-not-project')
    await eventually(() => expect(transport.getSnapshot().diagnostic).toEqual({
      closeCode: 1006,
      kind: 'tls_failed',
      stage: 'gateway_handshake',
    }))
    expect(JSON.stringify(transport.getSnapshot())).not.toContain('must-not-project')

    await transport.updateConfiguration('https://gateway.example.com')
    await eventually(() => expect(harness.sockets).toHaveLength(2))
    const recoveredSocket = harness.sockets[1]
    if (recoveredSocket === undefined) throw new Error('missing recovered SDK fixture WebSocket')
    recoveredSocket.open()
    recoveredSocket.receive({ type: 'ready', mountPath: 'device/device_01' })
    await eventually(() => expect(transport.getSnapshot()).toMatchObject({
      diagnostic: null,
      issue: null,
      state: 'ready',
    }))

    await transport.stopForLocalRevocation()
  })

  test('本机更新 URL 与 API key 时先关闭旧连接，再只连接新 audience', async () => {
    const harness = createWebSocketHarness()
    const credentialStore = new MemoryCredentialStore(credential)
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore,
      executeCommand: async () => ({ ok: true, value: null }),
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(harness.sockets).toHaveLength(1))
    const oldSocket = harness.sockets[0]
    if (oldSocket === undefined) throw new Error('missing old SDK fixture WebSocket')

    await transport.updateConfiguration(null)
    expect(oldSocket.readyState).toBe(FakeRawWebSocket.CLOSED)
    expect(transport.getSnapshot()).toMatchObject({
      gatewayOrigin: null,
      state: 'unconfigured',
    })

    credentialStore.value = {
      ...credential,
      audienceOrigin: 'https://new-gateway.example.com',
      material: 'new-secret',
    }
    await transport.updateConfiguration('https://new-gateway.example.com')
    await eventually(() => expect(harness.sockets).toHaveLength(2))
    expect(harness.inputs[1]).toEqual({
      headers: { authorization: 'Bearer new-secret' },
      url: 'wss://new-gateway.example.com/system/device/ws?deviceId=device_01',
    })
    expect(harness.inputs[1]?.url).not.toContain('new-secret')
    oldSocket.emitClose(1006, 'SSLHandshakeException: stale-secret')
    expect(transport.getSnapshot().diagnostic).toBeNull()
    expect(JSON.stringify(transport.getSnapshot())).not.toContain('stale-secret')
    await transport.stopForLocalRevocation()
  })

  test('缺凭证或 audience 不一致时 fail closed，完全不创建 WebSocket', async () => {
    const harness = createWebSocketHarness()
    const missing = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore: new MemoryCredentialStore(null),
      executeCommand: async () => ({ ok: true, value: null }),
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })
    await missing.updateLifecycle('active', true)
    expect(missing.getSnapshot().state).toBe('credentials_required')

    const mismatch = new SdkDeviceTransport({
      baseUrl: 'https://other.example.com',
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async () => ({ ok: true, value: null }),
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })
    await mismatch.updateLifecycle('active', true)
    expect(mismatch.getSnapshot()).toMatchObject({
      issue: 'credential_invalid',
      state: 'error',
    })
    expect(harness.sockets).toHaveLength(0)
  })

  test('SecureStore 读取等待期间 Disabled 会使旧 lifecycle 失效，不短暂创建连接', async () => {
    const harness = createWebSocketHarness()
    let releaseCredential!: (value: DeviceCredentialEnvelope | null) => void
    const credentialRead = new Promise<DeviceCredentialEnvelope | null>(resolve => {
      releaseCredential = resolve
    })
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore: {
        clear: async () => undefined,
        get: () => credentialRead,
        save: async () => undefined,
      },
      executeCommand: async () => ({ ok: true, value: null }),
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    const activating = transport.updateLifecycle('active', true)
    await Promise.resolve()
    const disabling = transport.updateLifecycle('active', false)
    releaseCredential(credential)
    await Promise.all([activating, disabling])

    expect(harness.sockets).toHaveLength(0)
    expect(transport.getSnapshot().state).toBe('suspended')
  })
})
