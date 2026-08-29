import { fetch as expoFetch } from 'expo/fetch'
import { z } from 'zod'

import { CapabilityRegistry } from '@/capabilities/registry'
import { SdkDeviceMailboxTransport } from '@/gateway/sdkDeviceMailboxTransport'

import type { MobileCapability } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'
import type {
  DeviceCredentialEnvelope,
  DeviceCredentialStore,
} from '@/identity/deviceCredentialStore'
import type {
  DeviceOperationJournal,
  DeviceOperationJournalEntry,
} from '@tool-bridge/sdk/device'

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }))

const mockedFetch = expoFetch as jest.MockedFunction<typeof expoFetch>
const OPERATION_ID = 'dop_AAAAAAAAAAAAAAAAAAAAAAAA'
const SERVER_NOW = '2026-08-29T06:30:00.000Z'
const EXPIRES_AT = '2026-08-29T07:30:00.000Z'

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

class RecordingJournal implements DeviceOperationJournal {
  readonly entries = new Map<string, DeviceOperationJournalEntry>()
  readonly events: string[] = []
  readonly writes: DeviceOperationJournalEntry[] = []

  async get(operationId: string): Promise<DeviceOperationJournalEntry | null> {
    this.events.push(`get:${operationId}`)
    return this.entries.get(operationId) ?? null
  }

  async put(entry: DeviceOperationJournalEntry): Promise<void> {
    const copy = structuredClone(entry)
    this.events.push(`put:${entry.state}`)
    this.entries.set(entry.operationId, copy)
    this.writes.push(copy)
  }

  async remove(operationId: string): Promise<void> {
    this.events.push(`remove:${operationId}`)
    this.entries.delete(operationId)
  }
}

function createMailboxRegistry(): CapabilityRegistry {
  const capability: MobileCapability<
    Readonly<{ body: string, title: string }>,
    Readonly<{ messageId: string, status: 'stored' }>
  > = {
    descriptor: {
      confirmation: 'never',
      description: '保存本地消息 fixture',
      effect: 'write',
      limits: {
        maxResultBytes: 2_048,
        rate: { maxGlobal: 60, maxPerCaller: 30, windowSeconds: 3_600 },
      },
      path: 'phone/inbox',
      queuePolicy: 'enqueue',
      risk: 'medium',
      tool: 'deliver',
    },
    execute: async () => ({ messageId: 'inbox_message_01', status: 'stored' }),
    inputSchema: z.strictObject({ body: z.string(), title: z.string() }),
    outputSchema: z.strictObject({
      messageId: z.string(),
      status: z.literal('stored'),
    }),
    probe: async () => ({ status: 'available' }),
  }
  const registry = new CapabilityRegistry()
  registry.register(capability)
  return registry
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function claim(): Record<string, unknown> {
  return {
    arguments: { body: '不得进入 journal 的正文', title: '本地来信' },
    attempt: 1,
    caller: { keyId: 'caller_key_01', owner: 'agent:writer' },
    commandId: OPERATION_ID,
    createdAt: SERVER_NOW,
    expiresAt: EXPIRES_AT,
    leaseId: 'lease_01',
    leaseUntil: '2026-08-29T06:31:00.000Z',
    operationId: OPERATION_ID,
    path: 'inbox/deliver',
    targetPath: 'device/phone/device_01/inbox/deliver',
    traceId: 'trace_01',
  }
}

function detail(result: unknown): Record<string, unknown> {
  return {
    attempt: 1,
    caller: { keyId: 'caller_key_01', owner: 'agent:writer' },
    commandId: OPERATION_ID,
    createdAt: SERVER_NOW,
    deviceId: 'device_01',
    executionMayHaveOccurred: false,
    expiresAt: EXPIRES_AT,
    mountPath: 'device/phone/device_01',
    operationId: OPERATION_ID,
    result,
    state: 'succeeded',
    targetPath: 'device/phone/device_01/inbox/deliver',
    terminalAt: SERVER_NOW,
    traceId: 'trace_01',
    updatedAt: SERVER_NOW,
  }
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

describe('SDK durable mailbox mobile transport', () => {
  beforeEach(() => { mockedFetch.mockReset() })

  test('前台有界 drain 经真实 SDK processor 完成 claim、本地执行与 complete', async () => {
    const journal = new RecordingJournal()
    const commands: LocalCommand[] = []
    mockedFetch.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/claim')) {
        const claimCalls = mockedFetch.mock.calls
          .filter(([url]) => new URL(String(url)).pathname.endsWith('/claim')).length
        return json(claimCalls === 1
          ? { operation: claim(), serverNow: SERVER_NOW }
          : { serverNow: SERVER_NOW }) as Awaited<ReturnType<typeof expoFetch>>
      }
      if (path.endsWith('/complete')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return json(detail(body.result)) as Awaited<ReturnType<typeof expoFetch>>
      }
      throw new Error(`unexpected mailbox path ${path}`)
    })
    const transport = new SdkDeviceMailboxTransport({
      baseUrl: credential.audienceOrigin,
      clock: () => new Date(SERVER_NOW),
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async command => {
        commands.push(command)
        return { ok: true, value: { messageId: 'inbox_message_01', status: 'stored' } }
      },
      journal,
      registry: createMailboxRegistry(),
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(mockedFetch).toHaveBeenCalledTimes(3))

    expect(commands).toEqual([expect.objectContaining({
      arguments: { body: '不得进入 journal 的正文', title: '本地来信' },
      caller: { displayName: 'agent:writer', subjectId: 'caller_key_01' },
      commandId: OPERATION_ID,
      expiresAt: EXPIRES_AT,
      path: 'phone/inbox',
      tool: 'deliver',
    })])
    expect(journal.events).toEqual([
      `get:${OPERATION_ID}`,
      'put:discovered',
      'put:executing',
      'put:terminal',
      `remove:${OPERATION_ID}`,
    ])
    expect(JSON.stringify(journal.writes)).not.toContain('不得进入 journal 的正文')
    expect(JSON.stringify(journal.writes)).not.toContain('本地来信')
    expect(new Headers(mockedFetch.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe('Bearer opaque-device-secret')
    expect(String(mockedFetch.mock.calls[0]?.[0])).not.toContain(credential.material)
    expect(JSON.parse(String(mockedFetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      deviceId: 'device_01',
      leaseId: 'lease_01',
      operationId: OPERATION_ID,
      outcome: 'succeeded',
      result: { messageId: 'inbox_message_01', status: 'stored' },
    })
  })

  test('后台不拉取，已开始的前台 drain 在生命周期变化时中止', async () => {
    let observedSignal: AbortSignal | undefined
    mockedFetch.mockImplementation(async (_input, init) => {
      observedSignal = init?.signal ?? undefined
      return await new Promise((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true })
      })
    })
    const transport = new SdkDeviceMailboxTransport({
      baseUrl: credential.audienceOrigin,
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand: async () => ({ ok: true, value: null }),
      journal: new RecordingJournal(),
      registry: createMailboxRegistry(),
    })

    await transport.updateLifecycle('background', true)
    expect(mockedFetch).not.toHaveBeenCalled()
    await transport.updateLifecycle('active', true)
    await eventually(() => expect(observedSignal).toBeDefined())
    await transport.updateLifecycle('inactive', true)
    expect(observedSignal?.aborted).toBe(true)
    await transport.updateLifecycle('active', false)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  test('切换 Gateway 配置会中止旧 drain，后续拉取只使用新 origin 与新凭证', async () => {
    const credentialStore = new MemoryCredentialStore(credential)
    let oldSignal: AbortSignal | undefined
    mockedFetch.mockImplementation(async (input, init) => {
      if (new URL(String(input)).origin === credential.audienceOrigin) {
        oldSignal = init?.signal ?? undefined
        return await new Promise((_resolve, reject) => {
          oldSignal?.addEventListener('abort', () => reject(oldSignal?.reason), { once: true })
        })
      }
      return json({ serverNow: SERVER_NOW }) as Awaited<ReturnType<typeof expoFetch>>
    })
    const transport = new SdkDeviceMailboxTransport({
      baseUrl: credential.audienceOrigin,
      credentialStore,
      executeCommand: async () => ({ ok: true, value: null }),
      journal: new RecordingJournal(),
      registry: createMailboxRegistry(),
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(oldSignal).toBeDefined())
    const newOrigin = 'https://gateway-new.example.com'
    credentialStore.value = {
      ...credential,
      audienceOrigin: newOrigin,
      material: 'new-opaque-device-secret',
    }
    await transport.updateConfiguration(newOrigin)

    expect(oldSignal?.aborted).toBe(true)
    await transport.updateLifecycle('active', true)
    await eventually(() => expect(mockedFetch).toHaveBeenCalledTimes(2))
    const [newUrl, newInit] = mockedFetch.mock.calls[1] ?? []
    expect(new URL(String(newUrl)).origin).toBe(newOrigin)
    expect(new Headers(newInit?.headers).get('authorization'))
      .toBe('Bearer new-opaque-device-secret')
  })

  test('恢复 executing journal 时提交 result_unknown，不重放本地副作用', async () => {
    const journal = new RecordingJournal()
    journal.entries.set(OPERATION_ID, {
      expiresAt: EXPIRES_AT,
      operationId: OPERATION_ID,
      state: 'executing',
      updatedAt: SERVER_NOW,
    })
    const executeCommand = jest.fn(async () => ({ ok: true as const, value: null }))
    mockedFetch.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/claim')) {
        const claimCalls = mockedFetch.mock.calls
          .filter(([url]) => new URL(String(url)).pathname.endsWith('/claim')).length
        return json(claimCalls === 1
          ? { operation: claim(), serverNow: SERVER_NOW }
          : { serverNow: SERVER_NOW }) as Awaited<ReturnType<typeof expoFetch>>
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json({
        ...detail(undefined),
        error: body.error,
        result: undefined,
        state: 'result_unknown',
      }) as Awaited<ReturnType<typeof expoFetch>>
    })
    const transport = new SdkDeviceMailboxTransport({
      baseUrl: credential.audienceOrigin,
      credentialStore: new MemoryCredentialStore(credential),
      executeCommand,
      journal,
      registry: createMailboxRegistry(),
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(mockedFetch).toHaveBeenCalledTimes(3))

    expect(executeCommand).not.toHaveBeenCalled()
    expect(JSON.parse(String(mockedFetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      error: { code: 'unavailable', retryable: false },
      operationId: OPERATION_ID,
      outcome: 'result_unknown',
    })
    expect(journal.events).toEqual([
      `get:${OPERATION_ID}`,
      'put:terminal',
      `remove:${OPERATION_ID}`,
    ])
  })

  test('mailbox 401 会触发 realtime 停止，且不等待其收敛就清除凭证', async () => {
    const credentialStore = new MemoryCredentialStore(credential)
    const onCredentialInvalid = jest.fn(() => new Promise<void>(() => {}))
    mockedFetch.mockResolvedValue(json({
      code: 'permission_denied',
      message: '设备凭证已失效',
      retryable: false,
    }, 401) as Awaited<ReturnType<typeof expoFetch>>)
    const transport = new SdkDeviceMailboxTransport({
      baseUrl: credential.audienceOrigin,
      credentialStore,
      executeCommand: async () => ({ ok: true, value: null }),
      journal: new RecordingJournal(),
      onCredentialInvalid,
      registry: createMailboxRegistry(),
    })

    await transport.updateLifecycle('active', true)
    await eventually(() => expect(credentialStore.value).toBeNull())
    expect(onCredentialInvalid).toHaveBeenCalledTimes(1)
  })
})
