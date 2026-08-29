import {
  decodeDeviceFrame,
  encodeDeviceFrame,
  TBError,
} from '@tool-bridge/sdk/device'
import { fetch as expoFetch } from 'expo/fetch'
import { z } from 'zod'

import { CapabilityRegistry } from '@/capabilities/registry'
import {
  createSdkDeviceCallHandler,
  LOCAL_CAMERA_COMMAND_TTL_MS,
  LOCAL_REALTIME_COMMAND_TTL_MS,
  parseDeviceCallPath,
  SdkDeviceTransport,
} from '@/gateway/sdkDeviceTransport'

import type { CapabilityInvocationServices, MobileCapability } from '@/capabilities/types'
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

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }))

const mockedFetch = expoFetch as jest.MockedFunction<typeof expoFetch>

const credential: DeviceCredentialEnvelope = {
  audienceOrigin: 'https://gateway.example.com',
  deviceId: 'device_01',
  keyId: 'device_key_01',
  material: 'opaque-device-secret',
  version: 1,
}

async function unavailableUploadObject(): Promise<never> {
  throw new TBError('unavailable', 'fixture call has no upload capability', { retryable: false })
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
  beforeEach(() => { mockedFetch.mockReset() })

  test('按最后一个斜杠拆分多层 device call path，并拒绝空路径段', () => {
    expect(parseDeviceCallPath('status/get')).toEqual({
      command: 'get',
      nodePath: 'status',
    })
    expect(parseDeviceCallPath('runtime/commands/list')).toEqual({
      command: 'list',
      nodePath: 'runtime/commands',
    })

    for (const path of ['status', '/get', 'status/', 'status//get', 'status/get/']) {
      try {
        parseDeviceCallPath(path)
        throw new Error(`未拒绝非法 path: ${path}`)
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_argument' })
      }
    }
  })

  test('把官方 call 映射到有本地期限的 executor command，并把本地错误归一为 TBError', async () => {
    const commands: LocalCommand[] = []
    const signals: AbortSignal[] = []
    const handler = createSdkDeviceCallHandler({
      callerSubjectId: 'device_key_01',
      clock: () => new Date('2026-08-19T10:00:00.000Z'),
      executeCommand: async (command, signal) => {
        commands.push(command)
        signals.push(signal)
        return { ok: true, value: { observed: true } }
      },
    })

    const signal = new AbortController().signal
    await expect(handler({
      arguments: {},
      id: 'call_01',
      path: 'fixture/get',
      signal,
      uploadObject: unavailableUploadObject,
    })).resolves.toEqual({ observed: true })
    expect(signals).toEqual([signal])
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

    // 旧 mount（device/<deviceId>）会话仍可能发送带 phone/ 前缀的绝对路径。
    await handler({
      arguments: {},
      id: 'call_01b',
      path: 'phone/fixture/get',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })
    expect(commands[1]).toMatchObject({ path: 'phone/fixture', tool: 'get' })

    await handler({
      arguments: { purpose: '拍摄设备' },
      id: 'call_camera',
      path: 'camera/capture_photo',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })
    expect(commands[2]).toMatchObject({
      expiresAt: new Date(
        Date.parse('2026-08-19T10:00:00.000Z') + LOCAL_CAMERA_COMMAND_TTL_MS,
      ).toISOString(),
      path: 'phone/camera',
      tool: 'capture_photo',
    })

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
      path: 'fixture/get',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })).rejects.toMatchObject({ code: 'permission_denied', retryable: false })
  })

  test('优先消费网关 context，收紧期限，缺失时才降级为 credential principal', async () => {
    const commands: LocalCommand[] = []
    const invocationServices: CapabilityInvocationServices[] = []
    const handler = createSdkDeviceCallHandler({
      callerSubjectId: 'credential_principal_01',
      clock: () => new Date('2026-08-19T10:00:00.000Z'),
      executeCommand: async (command, _signal, services) => {
        commands.push(command)
        invocationServices.push(services)
        return { ok: true, value: null }
      },
    })

    await handler({
      arguments: {
        caller: { keyId: 'argument_must_not_override' },
        context: { createdAt: '2099-01-01T00:00:00.000Z' },
        deadline: '2099-01-01T00:00:00.000Z',
      },
      context: {
        caller: {
          displayName: 'Research Agent',
          keyId: 'gateway_caller_key_01',
          owner: 'agent:researcher',
        },
        createdAt: '2026-08-19T09:59:58.000Z',
        expiresAt: '2026-08-19T10:00:20.000Z',
        traceId: 'trace_01',
      },
      id: 'context_01',
      path: 'status/get',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })
    expect(commands[0]).toMatchObject({
      arguments: {
        caller: { keyId: 'argument_must_not_override' },
        context: { createdAt: '2099-01-01T00:00:00.000Z' },
        deadline: '2099-01-01T00:00:00.000Z',
      },
      caller: { displayName: 'Research Agent', subjectId: 'gateway_caller_key_01' },
      createdAt: '2026-08-19T09:59:58.000Z',
      expiresAt: '2026-08-19T10:00:20.000Z',
      path: 'phone/status',
      tool: 'get',
    })

    await handler({
      arguments: {},
      context: {
        caller: { keyId: 'gateway_caller_key_02', owner: 'agent:planner' },
        createdAt: '2026-08-19T09:59:59.000Z',
        expiresAt: '2026-08-19T10:05:00.000Z',
        traceId: 'trace_02',
        upload: {
          expiresAt: '2026-08-19T10:00:10.000Z',
          maxBytes: 10 * 1024 * 1024,
          maxObjects: 1,
        },
      },
      id: 'context_02',
      path: 'runtime/commands/list',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })
    expect(commands[1]).toMatchObject({
      caller: { displayName: 'agent:planner', subjectId: 'gateway_caller_key_02' },
      createdAt: '2026-08-19T09:59:59.000Z',
      expiresAt: '2026-08-19T10:00:10.000Z',
      path: 'phone/runtime/commands',
      tool: 'list',
    })
    expect(invocationServices[1]?.uploadObject).toEqual(expect.any(Function))

    await handler({
      arguments: {},
      id: 'context_fallback',
      path: 'status/get',
      signal: new AbortController().signal,
      uploadObject: unavailableUploadObject,
    })
    expect(commands[2]).toMatchObject({
      caller: { displayName: 'Tool Bridge 网关', subjectId: 'credential_principal_01' },
      createdAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2026-08-19T10:00:30.000Z',
    })
    expect(invocationServices[0]).toEqual({})
    expect(invocationServices[2]).toEqual({})
  })

  test('真实 SDK supervisor 使用 RN header、hello/ready/call/result，仅在 Disabled 时 suspend', async () => {
    const harness = createWebSocketHarness()
    const commands: LocalCommand[] = []
    let cancelledSignal: AbortSignal | null = null
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      clock: () => new Date('2026-08-19T10:00:00.000Z'),
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async (command, signal) => {
        commands.push(command)
        if (command.commandId === 'call_cancel') {
          cancelledSignal = signal
          return await new Promise(resolve => {
            signal.addEventListener('abort', () => resolve({
              error: { code: 'cancelled', message: '调用已取消', retryable: true },
              ok: false,
            }), { once: true })
          })
        }
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
          path: 'fixture',
        }],
      },
      mountPath: 'device/phone/device_01',
      type: 'hello',
    })

    socket.receive({ type: 'ready', mountPath: 'device/phone/device_01' })
    await eventually(() => expect(transport.getSnapshot()).toMatchObject({
      deviceId: 'device_01',
      gatewayOrigin: 'https://gateway.example.com',
      mountPath: 'device/phone/device_01',
      state: 'ready',
    }))
    socket.sent.length = 0
    const callFrame: DeviceFrame = {
      arguments: {},
      context: {
        caller: { keyId: 'gateway_caller_key_03', owner: 'agent:device-check' },
        createdAt: '2026-08-19T10:00:00.000Z',
        expiresAt: '2026-08-19T10:00:20.000Z',
        traceId: 'trace_03',
      },
      id: 'call_03',
      path: 'fixture/get',
      type: 'call',
    }
    socket.receive(callFrame)
    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toEqual({
      id: 'call_03',
      ok: true,
      type: 'result',
      value: { status: 'ok' },
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      caller: { displayName: 'agent:device-check', subjectId: 'gateway_caller_key_03' },
      path: 'phone/fixture',
      tool: 'get',
    })
    expect(transport.getSnapshot().issue).toBeNull()

    // 同一 commandId 的重放由 SDK 内存 cache 直接返回，不再进入 executor；
    // SQLite command repository 仍是跨进程的防重放真相。
    socket.sent.length = 0
    socket.receive(callFrame)
    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(commands).toHaveLength(1)
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toMatchObject({
      id: 'call_03',
      ok: true,
      type: 'result',
    })

    socket.sent.length = 0
    socket.receive({
      arguments: {},
      id: 'call_cancel',
      path: 'fixture/get',
      type: 'call',
    })
    await eventually(() => expect(cancelledSignal).not.toBeNull())
    socket.receive({ id: 'call_cancel', type: 'cancel' })
    await eventually(() => expect(cancelledSignal?.aborted).toBe(true))
    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toMatchObject({
      error: { code: 'unavailable', retryable: true },
      id: 'call_cancel',
      ok: false,
      type: 'result',
    })
    expect(transport.getSnapshot().issue).toBeNull()

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

  test('真实 SDK 用每次 call 的窄 capability 上传 Store 对象', async () => {
    const harness = createWebSocketHarness()
    const storeUri = 'store://default/AbCdEfGhIjKlMnOpQrStUv' as const
    const checksum = 'd'.repeat(64)
    const body = new Blob(['jpeg'], { type: 'image/jpeg' })
    mockedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        expiresAt: '2099-08-26T01:05:00.000Z',
        headers: {},
        maxBytes: 10 * 1024 * 1024,
        method: 'PUT',
        objectUri: storeUri,
        transport: 'relay',
        uploadId: 'upload_01',
        uploadToken: 'relay-upload-token',
        url: 'https://gateway.example.com/~store/uploads/upload_01',
      }), { status: 200 }) as unknown as Awaited<ReturnType<typeof expoFetch>>)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checksum: { algorithm: 'sha256', value: checksum },
        contentType: 'image/jpeg',
        createdAt: '2026-08-26T01:00:00.000Z',
        readyAt: '2026-08-26T01:00:01.000Z',
        size: body.size,
        uri: storeUri,
      }), { status: 200 }) as unknown as Awaited<ReturnType<typeof expoFetch>>)

    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async (_command, _signal, invocationServices) => {
        if (invocationServices.uploadObject === undefined) {
          return {
            error: { code: 'unavailable', message: '缺少上传能力', retryable: false },
            ok: false,
          }
        }
        const uploaded = await invocationServices.uploadObject({
          body,
          checksum: { algorithm: 'sha256', value: checksum },
          contentType: 'image/jpeg',
          filename: 'capture.jpg',
          idempotencyKey: 'camera-call_01',
          size: body.size,
        })
        return { ok: true, value: { objectRef: uploaded.uri } }
      },
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(harness.sockets).toHaveLength(1))
    const socket = harness.sockets[0]
    if (socket === undefined) throw new Error('missing SDK fixture WebSocket')
    socket.open()
    await eventually(() => expect(socket.sent).toHaveLength(1))
    socket.receive({ type: 'ready', mountPath: 'device/phone/device_01' })
    await eventually(() => expect(transport.getSnapshot().state).toBe('ready'))
    socket.sent.length = 0

    socket.receive({
      arguments: {},
      context: {
        caller: { keyId: 'gateway_caller_key_04', owner: 'agent:camera' },
        createdAt: '2026-08-26T01:00:00.000Z',
        expiresAt: '2099-08-26T01:02:00.000Z',
        traceId: 'trace_04',
        upload: {
          expiresAt: '2099-08-26T01:02:00.000Z',
          maxBytes: 10 * 1024 * 1024,
          maxObjects: 1,
          token: 'call-upload-token',
        },
      },
      id: 'call_upload_01',
      path: 'fixture/get',
      type: 'call',
    })

    await eventually(() => expect(socket.sent).toHaveLength(1))
    expect(decodeDeviceFrame(socket.sent[0] ?? '')).toEqual({
      id: 'call_upload_01',
      ok: true,
      type: 'result',
      value: { objectRef: storeUri },
    })
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    const [grantUrl, grantInit] = mockedFetch.mock.calls[0] ?? []
    expect(String(grantUrl)).toBe('https://gateway.example.com/system/store/create_upload')
    expect(new Headers(grantInit?.headers).get('x-tb-store-capability'))
      .toBe('call-upload-token')
    expect(new Headers(grantInit?.headers).has('authorization')).toBe(false)
    expect(JSON.parse(String(grantInit?.body))).toEqual({
      checksum: { algorithm: 'sha256', value: checksum },
      contentType: 'image/jpeg',
      filename: 'capture.jpg',
      idempotencyKey: 'camera-call_01',
      size: body.size,
    })
    const [uploadUrl, uploadInit] = mockedFetch.mock.calls[1] ?? []
    expect(String(uploadUrl)).toBe('https://gateway.example.com/~store/uploads/upload_01')
    expect(new Headers(uploadInit?.headers).get('x-tb-store-upload')).toBe('relay-upload-token')
    expect(uploadInit?.body).toBe(body)
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
    recoveredSocket.receive({ type: 'ready', mountPath: 'device/phone/device_01' })
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

  test('realtime 鉴权拒绝时即使 mailbox 停止不收敛也会清除凭证', async () => {
    const harness = createWebSocketHarness()
    const credentialStore = new MemoryCredentialStore(credential)
    const onCredentialInvalid = jest.fn(() => new Promise<void>(() => {}))
    const transport = new SdkDeviceTransport({
      baseUrl: 'https://gateway.example.com',
      credentialStore,
      executeCommand: async () => ({ ok: true, value: null }),
      onCredentialInvalid,
      registry: createRegistry(),
      webSocketFactory: harness.factory,
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(harness.sockets).toHaveLength(1))
    const socket = harness.sockets[0]
    if (socket === undefined) throw new Error('missing auth rejection fixture WebSocket')
    socket.open()
    await eventually(() => expect(socket.sent).toHaveLength(1))
    socket.receive({
      error: {
        code: 'permission_denied',
        message: '设备凭证已失效',
        retryable: false,
      },
      type: 'error',
    })

    await eventually(() => expect(credentialStore.value).toBeNull())
    expect(onCredentialInvalid).toHaveBeenCalledTimes(1)
    await transport.stopForLocalRevocation()
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
