import {
  connectDevice,
  createReactNativeWebSocketFactory,
  TBError,
} from '@tool-bridge/sdk/device'

import {
  diagnoseDeviceTransportClose,
  type DeviceTransportDiagnostic,
  type DeviceTransportFailureStage,
} from './deviceTransportDiagnostic'

import type { CapabilityRegistry } from '@/capabilities/registry'
import type { CommandOutcome, LocalCommand } from '@/commands/types'
import type {
  DeviceCredentialEnvelope,
  DeviceCredentialStore,
} from '@/identity/deviceCredentialStore'
import type {
  DeviceCallHandler,
  DeviceConnection,
  DeviceConnectionState,
  DeviceWebSocketFactory,
} from '@tool-bridge/sdk/device'

export const LOCAL_REALTIME_COMMAND_TTL_MS = 30_000

export type DeviceTransportState =
  | DeviceConnectionState
  | 'credentials_required'
  | 'error'
  | 'unconfigured'

export type DeviceTransportIssue =
  | 'credential_invalid'
  | 'protocol_error'
  | 'transport_error'

export type DeviceTransportSnapshot = Readonly<{
  diagnostic: DeviceTransportDiagnostic | null
  deviceId: string | null
  gatewayOrigin: string | null
  issue: DeviceTransportIssue | null
  mountPath: string | null
  state: DeviceTransportState
}>

function disconnectedSnapshot(baseUrl: string | null): DeviceTransportSnapshot {
  return {
    diagnostic: null,
    deviceId: null,
    gatewayOrigin: baseUrl,
    issue: null,
    mountPath: null,
    state: baseUrl === null ? 'unconfigured' : 'credentials_required',
  }
}

type ExecuteCommand = (command: LocalCommand, signal: AbortSignal) => Promise<CommandOutcome>

type DeviceConnect = typeof connectDevice

type SdkDeviceTransportDependencies = Readonly<{
  baseUrl: string | null
  clock?: () => Date
  connect?: DeviceConnect
  credentialStore: DeviceCredentialStore
  executeCommand: ExecuteCommand
  onSnapshotChange?: () => void
  registry: CapabilityRegistry
  webSocketFactory?: DeviceWebSocketFactory
}>

const permissionErrorCodes = new Set([
  'confirmation_queue_full',
  'confirmation_required',
  'disabled',
  'permission_denied',
  'source_not_allowed',
  'url_not_allowed',
  'user_rejected',
])

const unavailableErrorCodes = new Set([
  'cancelled',
  'expired',
  'linking_probe_timeout',
  'media_fetch_failed',
  'notification_status_unknown',
  'notification_unavailable',
  'stale_location',
  'timeout',
  'timer_cancel_status_unknown',
  'timer_schedule_status_unknown',
  'timer_unavailable',
  'unavailable',
])

function sdkErrorFor(outcome: Extract<CommandOutcome, { ok: false }>): TBError {
  const { error } = outcome
  if (error.code === 'invalid_argument') {
    return new TBError('invalid_argument', error.message)
  }
  if (error.code === 'not_found') return new TBError('not_found', error.message)
  if (error.code === 'rate_limited') {
    return new TBError('rate_limited', error.message, { retryable: error.retryable })
  }
  if (permissionErrorCodes.has(error.code)) {
    return new TBError('permission_denied', error.message)
  }
  if (unavailableErrorCodes.has(error.code)) {
    return new TBError('unavailable', error.message, { retryable: error.retryable })
  }
  return new TBError('internal', error.message, { retryable: error.retryable })
}

export function createSdkDeviceCallHandler(options: Readonly<{
  callerSubjectId: string
  clock?: () => Date
  executeCommand: ExecuteCommand
}>): DeviceCallHandler {
  const clock = options.clock ?? (() => new Date())
  return async call => {
    const receivedAt = clock()
    const outcome = await options.executeCommand({
      arguments: call.arguments,
      caller: {
        displayName: 'Tool Bridge 网关',
        subjectId: options.callerSubjectId,
      },
      commandId: call.id,
      createdAt: receivedAt.toISOString(),
      expiresAt: new Date(receivedAt.getTime() + LOCAL_REALTIME_COMMAND_TTL_MS).toISOString(),
      path: call.path,
      tool: call.tool,
    }, call.signal)
    if (!outcome.ok) throw sdkErrorFor(outcome)
    return outcome.value
  }
}

function validateCredential(
  credential: DeviceCredentialEnvelope,
  baseUrl: string,
): DeviceCredentialEnvelope {
  if (credential.audienceOrigin !== baseUrl) {
    throw new Error('设备凭证 audience 与 gateway origin 不一致')
  }
  return credential
}

export class SdkDeviceTransport {
  readonly #clock: () => Date
  readonly #connect: DeviceConnect
  readonly #webSocketFactory: DeviceWebSocketFactory
  #appState = 'unknown'
  #baseUrl: string | null
  #connection: DeviceConnection | null = null
  #diagnosticRevision = 0
  #enabled = true
  #lifecycleRevision = 0
  #snapshot: DeviceTransportSnapshot
  #suppressActiveSocketDiagnostic: (() => void) | null = null
  #transition: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: SdkDeviceTransportDependencies) {
    this.#baseUrl = dependencies.baseUrl
    this.#clock = dependencies.clock ?? (() => new Date())
    this.#connect = dependencies.connect ?? connectDevice
    this.#snapshot = disconnectedSnapshot(this.#baseUrl)
    this.#webSocketFactory = dependencies.webSocketFactory
      ?? createReactNativeWebSocketFactory(globalThis.WebSocket)
  }

  getSnapshot(): DeviceTransportSnapshot {
    return this.#snapshot
  }

  updateLifecycle(appState: string, enabled: boolean): Promise<void> {
    this.#appState = appState
    this.#enabled = enabled
    const revision = ++this.#lifecycleRevision
    this.#transition = this.#transition
      .then(() => this.#applyLifecycle(revision))
      .catch(() => {
        this.#publish({ ...this.#snapshot, issue: 'transport_error', state: 'error' })
      })
    return this.#transition
  }

  updateConfiguration(baseUrl: string | null): Promise<void> {
    this.#baseUrl = baseUrl
    const revision = ++this.#lifecycleRevision
    this.#transition = this.#transition
      .then(async () => {
        const connection = this.#connection
        this.#connection = null
        this.#suppressActiveSocketDiagnostic?.()
        this.#diagnosticRevision += 1
        connection?.close()
        await this.#applyLifecycle(revision)
      })
      .catch(() => {
        this.#publish({
          ...this.#snapshot,
          gatewayOrigin: this.#baseUrl,
          issue: 'transport_error',
          state: 'error',
        })
      })
    return this.#transition
  }

  async stopForLocalRevocation(): Promise<void> {
    this.#enabled = false
    this.#lifecycleRevision += 1
    await this.#transition
    const connection = this.#connection
    this.#connection = null
    this.#suppressActiveSocketDiagnostic?.()
    this.#diagnosticRevision += 1
    connection?.close()
    if (connection !== null) await connection.closed
    this.#publish({
      diagnostic: null,
      deviceId: null,
      gatewayOrigin: this.#baseUrl,
      issue: null,
      mountPath: null,
      state: this.#baseUrl === null ? 'unconfigured' : 'credentials_required',
    })
  }

  async #applyLifecycle(revision: number): Promise<void> {
    const baseUrl = this.#baseUrl
    if (baseUrl === null) {
      this.#suppressActiveSocketDiagnostic?.()
      this.#connection?.suspend()
      this.#publish(disconnectedSnapshot(null))
      return
    }

    if (!this.#enabled || this.#appState !== 'active') {
      this.#suppressActiveSocketDiagnostic?.()
      this.#connection?.suspend()
      if (this.#connection === null) {
        this.#publish({
          ...this.#snapshot,
          issue: null,
          state: 'suspended',
        })
      }
      return
    }

    if (this.#connection !== null) {
      this.#connection.resume()
      return
    }

    let initialCredential: DeviceCredentialEnvelope | null
    try {
      initialCredential = await this.dependencies.credentialStore.get()
      if (initialCredential !== null) validateCredential(initialCredential, baseUrl)
    } catch {
      this.#publish({
        diagnostic: null,
        deviceId: null,
        gatewayOrigin: baseUrl,
        issue: 'credential_invalid',
        mountPath: null,
        state: 'error',
      })
      return
    }
    if (revision !== this.#lifecycleRevision) return
    if (initialCredential === null) {
      this.#publish({
        diagnostic: null,
        deviceId: null,
        gatewayOrigin: baseUrl,
        issue: null,
        mountPath: null,
        state: 'credentials_required',
      })
      return
    }

    this.#startConnection(baseUrl, initialCredential)
  }

  #startConnection(baseUrl: string, initialCredential: DeviceCredentialEnvelope): void {
    let createdConnection: DeviceConnection
    const diagnosticRevision = ++this.#diagnosticRevision
    let activeAttempt: Readonly<{
      id: number
      socket: WebSocket
    }> | null = null
    let activeAttemptId = 0
    let activeStage: DeviceTransportFailureStage = 'socket_opening'
    let diagnosticsSuppressed = false
    this.#suppressActiveSocketDiagnostic = () => {
      activeAttempt = null
      diagnosticsSuppressed = true
    }
    const handler = createSdkDeviceCallHandler({
      callerSubjectId: initialCredential.keyId,
      clock: this.#clock,
      executeCommand: this.dependencies.executeCommand,
    })

    this.#publish({
      diagnostic: null,
      deviceId: initialCredential.deviceId,
      gatewayOrigin: baseUrl,
      issue: null,
      mountPath: null,
      state: 'connecting',
    })
    createdConnection = this.#connect({
      baseUrl,
      credentialProvider: {
        invalidate: () => { void this.#invalidateCredential(createdConnection) },
        prepare: async ({ signal }) => {
          if (signal.aborted) throw new Error('设备凭证读取已取消')
          const credential = await this.dependencies.credentialStore.get()
          if (credential === null) throw new Error('设备凭证不存在')
          validateCredential(credential, baseUrl)
          if (credential.deviceId !== initialCredential.deviceId) {
            throw new Error('设备凭证 deviceId 在连接期间发生变化')
          }
          return { headers: { authorization: `Bearer ${credential.material}` } }
        },
      },
      deviceId: initialCredential.deviceId,
      expose: () => this.dependencies.registry.deviceExpose(),
      handler,
      onError: () => {
        if (this.#connection !== createdConnection || diagnosticsSuppressed) return
        this.#publish({
          ...this.#snapshot,
          diagnostic: this.#snapshot.diagnostic ?? {
            closeCode: null,
            kind: 'unknown',
            stage: activeStage,
          },
          issue: 'transport_error',
        })
      },
      onProtocolError: () => {
        if (this.#connection !== createdConnection) return
        this.#publish({ ...this.#snapshot, issue: 'protocol_error' })
      },
      onStateChange: state => {
        if (this.#connection !== createdConnection) return
        if (state === 'ready') activeStage = 'session'
        this.#publish({
          ...this.#snapshot,
          diagnostic: state === 'ready' ? null : this.#snapshot.diagnostic,
          issue: state === 'ready' ? null : this.#snapshot.issue,
          state,
        })
      },
      webSocketFactory: {
        open: input => {
          diagnosticsSuppressed = false
          const socket = this.#webSocketFactory.open(input)
          const attemptId = ++activeAttemptId
          activeAttempt = { id: attemptId, socket }
          activeStage = 'socket_opening'
          socket.addEventListener('open', () => {
            if (
              diagnosticRevision !== this.#diagnosticRevision
              || activeAttempt?.id !== attemptId
              || activeAttempt.socket !== socket
            ) return
            activeStage = 'gateway_handshake'
          })
          socket.addEventListener('close', event => {
            if (
              diagnosticRevision !== this.#diagnosticRevision
              || activeAttempt?.id !== attemptId
              || activeAttempt.socket !== socket
            ) return
            const diagnostic = diagnoseDeviceTransportClose(event, activeStage)
            activeAttempt = null
            this.#publish({
              ...this.#snapshot,
              diagnostic,
              issue: 'transport_error',
            })
          })
          return socket
        },
      },
    })
    this.#connection = createdConnection
    void createdConnection.ready.then(mountPath => {
      if (this.#connection !== createdConnection) return
      this.#publish({ ...this.#snapshot, mountPath })
    }).catch(() => {
      if (this.#connection !== createdConnection) return
      this.#publish({ ...this.#snapshot, issue: 'transport_error', state: 'error' })
    })
  }

  async #invalidateCredential(connection: DeviceConnection): Promise<void> {
    try {
      await this.dependencies.credentialStore.clear()
      if (this.#connection === connection) {
        this.#suppressActiveSocketDiagnostic?.()
        this.#diagnosticRevision += 1
        this.#connection = null
      }
      this.#publish({
        diagnostic: null,
        deviceId: null,
        gatewayOrigin: this.#baseUrl,
        issue: null,
        mountPath: null,
        state: this.#baseUrl === null ? 'unconfigured' : 'credentials_required',
      })
    } catch {
      this.#publish({ ...this.#snapshot, issue: 'credential_invalid', state: 'error' })
    }
  }

  #publish(snapshot: DeviceTransportSnapshot): void {
    if (
      snapshot.deviceId === this.#snapshot.deviceId
      && snapshot.diagnostic?.closeCode === this.#snapshot.diagnostic?.closeCode
      && snapshot.diagnostic?.kind === this.#snapshot.diagnostic?.kind
      && snapshot.diagnostic?.stage === this.#snapshot.diagnostic?.stage
      && snapshot.gatewayOrigin === this.#snapshot.gatewayOrigin
      && snapshot.issue === this.#snapshot.issue
      && snapshot.mountPath === this.#snapshot.mountPath
      && snapshot.state === this.#snapshot.state
    ) return
    this.#snapshot = snapshot
    this.dependencies.onSnapshotChange?.()
  }
}
