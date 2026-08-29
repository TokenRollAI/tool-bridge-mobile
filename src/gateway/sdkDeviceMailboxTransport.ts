import { createDeviceMailboxProcessor } from '@tool-bridge/sdk/device'
import { fetch as expoFetch } from 'expo/fetch'

import {
  createSdkDeviceCallHandler,
  toWireNodePath,
} from './sdkDeviceTransport'

import type { CapabilityRegistry } from '@/capabilities/registry'
import type { CapabilityInvocationServices } from '@/capabilities/types'
import type { CommandOutcome, LocalCommand } from '@/commands/types'
import type {
  DeviceCredentialEnvelope,
  DeviceCredentialStore,
} from '@/identity/deviceCredentialStore'
import type {
  DeviceOperationJournal,
  DeviceMailboxProcessor,
} from '@tool-bridge/sdk/device'

const MAX_MAILBOX_OPERATIONS_PER_DRAIN = 20

type ExecuteCommand = (
  command: LocalCommand,
  signal: AbortSignal,
  invocationServices: CapabilityInvocationServices,
) => Promise<CommandOutcome>

type MailboxProcessorFactory = typeof createDeviceMailboxProcessor

type SdkDeviceMailboxTransportDependencies = Readonly<{
  baseUrl: string | null
  clock?: () => Date
  createProcessor?: MailboxProcessorFactory
  credentialStore: DeviceCredentialStore
  executeCommand: ExecuteCommand
  fetcher?: typeof globalThis.fetch
  journal: DeviceOperationJournal
  onCredentialInvalid?: () => Promise<void> | void
  registry: CapabilityRegistry
}>

function validateCredential(
  credential: DeviceCredentialEnvelope,
  baseUrl: string,
  expectedDeviceId?: string,
): DeviceCredentialEnvelope {
  if (credential.audienceOrigin !== baseUrl) {
    throw new Error('设备凭证 audience 与 mailbox gateway origin 不一致')
  }
  if (expectedDeviceId !== undefined && credential.deviceId !== expectedDeviceId) {
    throw new Error('设备凭证 deviceId 在 mailbox 拉取期间发生变化')
  }
  return credential
}

/**
 * 宿主显式触发的 durable mailbox transport。它不启动 timer、不在后台轮询，
 * 只在 App 启动/回到前台时做一次有界 drain。
 */
export class SdkDeviceMailboxTransport {
  readonly #clock: () => Date
  readonly #createProcessor: MailboxProcessorFactory
  readonly #fetcher: typeof globalThis.fetch
  #active: Readonly<{
    controller: AbortController
    promise: Promise<void>
  }> | null = null
  #baseUrl: string | null
  #credentialInvalidation: Promise<void> | null = null
  #enabled = true
  #revision = 0

  constructor(private readonly dependencies: SdkDeviceMailboxTransportDependencies) {
    this.#baseUrl = dependencies.baseUrl
    this.#clock = dependencies.clock ?? (() => new Date())
    this.#createProcessor = dependencies.createProcessor ?? createDeviceMailboxProcessor
    this.#fetcher = dependencies.fetcher ?? (expoFetch as typeof globalThis.fetch)
  }

  async updateConfiguration(baseUrl: string | null): Promise<void> {
    this.#revision += 1
    this.#baseUrl = baseUrl
    await this.#stopActive()
  }

  async updateLifecycle(appState: string, enabled: boolean): Promise<void> {
    this.#enabled = enabled
    const revision = ++this.#revision
    if (!enabled || appState !== 'active') {
      await this.#stopActive()
      return
    }
    this.#startDrain(revision)
  }

  async stopForLocalRevocation(): Promise<void> {
    this.#enabled = false
    this.#revision += 1
    await this.#stopActive()
  }

  #startDrain(revision: number): void {
    if (this.#active !== null || this.#baseUrl === null || !this.#enabled) return
    const controller = new AbortController()
    const promise = this.#drain(revision, controller.signal)
      .catch(() => {
        // 网络、凭证或协议失败只终止本次显式 drain；不泄漏远端响应，
        // 也不把 mailbox 失败写成 realtime online/offline 事实。
      })
      .finally(() => {
        if (this.#active?.promise === promise) this.#active = null
      })
    this.#active = { controller, promise }
  }

  async #drain(revision: number, signal: AbortSignal): Promise<void> {
    const baseUrl = this.#baseUrl
    if (baseUrl === null) return
    const initialCredential = await this.dependencies.credentialStore.get()
    if (signal.aborted || revision !== this.#revision || !this.#enabled) return
    if (initialCredential === null) return
    validateCredential(initialCredential, baseUrl)

    const processor: DeviceMailboxProcessor = this.#createProcessor({
      baseUrl,
      credentialProvider: {
        invalidate: () => { void this.#invalidateCredential().catch(() => {}) },
        prepare: async ({ baseUrl: requestedBaseUrl, deviceId, signal: prepareSignal }) => {
          if (prepareSignal.aborted) throw prepareSignal.reason
          if (requestedBaseUrl !== baseUrl || deviceId !== initialCredential.deviceId) {
            throw new Error('mailbox 凭证请求与当前配置不一致')
          }
          const credential = await this.dependencies.credentialStore.get()
          if (credential === null) throw new Error('mailbox 设备凭证不存在')
          validateCredential(credential, baseUrl, initialCredential.deviceId)
          return { headers: { authorization: `Bearer ${credential.material}` } }
        },
      },
      deviceId: initialCredential.deviceId,
      expose: () => {
        const expose = this.dependencies.registry.deviceExpose()
        return {
          nodes: expose.nodes.map(node => ({ ...node, path: toWireNodePath(node.path) })),
        }
      },
      fetcher: this.#fetcher,
      handler: createSdkDeviceCallHandler({
        callerSubjectId: initialCredential.keyId,
        clock: this.#clock,
        delivery: 'mailbox',
        executeCommand: this.dependencies.executeCommand,
      }),
      journal: this.dependencies.journal,
      maxDrainOperations: MAX_MAILBOX_OPERATIONS_PER_DRAIN,
    })
    await processor.drain({
      maxOperations: MAX_MAILBOX_OPERATIONS_PER_DRAIN,
      signal,
    })
  }

  #invalidateCredential(): Promise<void> {
    this.#active?.controller.abort(new Error('mailbox 设备凭证已被 Gateway 拒绝'))
    if (this.#credentialInvalidation !== null) return this.#credentialInvalidation
    const invalidation = (async () => {
      try {
        void Promise.resolve(this.dependencies.onCredentialInvalid?.()).catch(() => {})
      } catch {
        // sibling transport 的停止已尝试触发；继续清除已失效的 bearer。
      }
      await this.dependencies.credentialStore.clear()
    })().finally(() => {
      if (this.#credentialInvalidation === invalidation) this.#credentialInvalidation = null
    })
    this.#credentialInvalidation = invalidation
    return invalidation
  }

  async #stopActive(): Promise<void> {
    const active = this.#active
    if (active === null) return
    active.controller.abort(new Error('mailbox drain 已被本地生命周期中止'))
    await active.promise
  }
}
