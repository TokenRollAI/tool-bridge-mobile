import { fetch as expoFetch } from 'expo/fetch'
import Constants from 'expo-constants'
import { Linking } from 'react-native'

import {
  ACTIVITY_HISTORY_DISPLAY_LIMIT,
  LOCAL_AUDIT_RETENTION_LIMIT,
  type AuditRecord,
} from '@/audit/types'
import {
  createCanOpenUrlCapability,
  createOpenUrlCapability,
} from '@/capabilities/apps/appsCapabilities'
import { AppHandoffController } from '@/capabilities/apps/controller'
import { ExpoAppLinkingAdapter } from '@/capabilities/apps/linkingAdapter'
import {
  createAttentionRingCapability,
  createAttentionStopCapability,
} from '@/capabilities/attention/attentionCapabilities'
import { AttentionSessionController } from '@/capabilities/attention/controller'
import { NativeAttentionFlashAdapter } from '@/capabilities/attention/flashAdapter'
import { NativeAttentionHapticsAdapter } from '@/capabilities/attention/hapticsAdapter'
import { ExpoAttentionSoundAdapter } from '@/capabilities/attention/soundAdapter'
import { CurrentLocationController } from '@/capabilities/location/controller'
import { ExpoCurrentLocationAdapter } from '@/capabilities/location/locationAdapter'
import { createCurrentLocationCapability } from '@/capabilities/location/locationCapability'
import { ExpoMapHandoffAdapter } from '@/capabilities/location/mapHandoffAdapter'
import { createOpenMapCapability } from '@/capabilities/location/openMapCapability'
import { OpenMapController } from '@/capabilities/location/openMapController'
import { MediaSessionController } from '@/capabilities/media/controller'
import { ExpoAudioPlaybackPortFactory } from '@/capabilities/media/expoAudioPlaybackPort'
import { ExpoMediaCacheStore } from '@/capabilities/media/expoMediaCacheStore'
import {
  createMediaPauseCapability,
  createMediaPlayCapability,
  createMediaResumeCapability,
  createMediaSeekCapability,
  createMediaStatusCapability,
  createMediaStopCapability,
} from '@/capabilities/media/mediaCapabilities'
import { BoundedMediaSourceResolver } from '@/capabilities/media/sourceResolver'
import { ExpoLocalNotificationAdapter } from '@/capabilities/productivity/notificationAdapter'
import { createLocalNotificationCapability } from '@/capabilities/productivity/notificationCapability'
import { LocalNotificationController } from '@/capabilities/productivity/notificationController'
import {
  createTimerCancelCapability,
  createTimerStartCapability,
  createTimerStatusCapability,
} from '@/capabilities/productivity/timerCapabilities'
import { LocalTimerController } from '@/capabilities/productivity/timerController'
import { CapabilityRegistry } from '@/capabilities/registry'
import {
  createRuntimeCancelCapability,
  createRuntimeCapabilitiesCapability,
  createRuntimePendingCommandsCapability,
} from '@/capabilities/runtime/runtimeCapabilities'
import { currentRuntimeAppState, ExpoStatusProbe } from '@/capabilities/status/probe'
import { createStatusCapability } from '@/capabilities/status/statusCapability'
import { NativeSystemAdapter, type SystemAdapter } from '@/capabilities/system/systemAdapter'
import {
  createAccessibilityStatusCapability,
  createClipboardGetCapability,
  createClipboardSetCapability,
  createExecShellCapability,
  createOpenIntentCapability,
} from '@/capabilities/system/systemCapabilities'
import { LOCAL_COMMAND_RETENTION_LIMIT } from '@/commands/repository'
import { ManualGatewayConfigurationController } from '@/gateway/manualGatewayConfigurationController'
import { SdkDeviceTransport } from '@/gateway/sdkDeviceTransport'
import { SecureDeviceCredentialStore } from '@/identity/deviceCredentialStore'
import { resolveDefaultDeviceId } from '@/identity/deviceIdentity'
import { SecureInstallationIdentityStore } from '@/identity/installationIdentityStore'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { SqliteAuditRepository } from '@/storage/auditRepository'
import { SqliteBackgroundRuntimeRepository } from '@/storage/backgroundRuntimeRepository'
import { SqliteCommandRepository } from '@/storage/commandRepository'
import { SqliteControlModeRepository } from '@/storage/controlModeRepository'
import { MobileDatabase } from '@/storage/database'
import { SqliteTimerRepository } from '@/storage/timerRepository'

import { LocalCommandExecutor } from './localCommandExecutor'

import type { AttentionSessionSnapshot } from '@/capabilities/attention/controller'
import type { MediaSessionSnapshot } from '@/capabilities/media/controller'
import type { TimerSnapshot } from '@/capabilities/productivity/timerController'
import type {
  CapabilityContext,
  CapabilitySnapshot,
  Reachability,
  RuntimeAppState,
} from '@/capabilities/types'
import type { CommandOutcome, ControlMode } from '@/commands/types'
import type {
  DeviceTransportDiagnostic,
} from '@/gateway/deviceTransportDiagnostic'
import type {
  DeviceTransportIssue,
  DeviceTransportState,
} from '@/gateway/sdkDeviceTransport'
import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'
import type { PendingConfirmationSnapshot } from '@/policy/localConfirmationCoordinator'

export type RuntimePhase = 'loading' | 'ready' | 'error'

export type EmergencyDisableResult = Readonly<{
  cancelledCommands: number
  localEffectStopFailures: number
}>

export type ApplicationSnapshot = Readonly<{
  appState: RuntimeAppState
  attentionSession: AttentionSessionSnapshot | null
  auditRecords: readonly AuditRecord[]
  backgroundRuntimeEnabled: boolean
  capabilities: readonly CapabilitySnapshot[]
  controlMode: ControlMode
  defaultDeviceId: string | null
  deviceId: string | null
  error: string | null
  gatewayOrigin: string | null
  installationId: string | null
  mediaSession: MediaSessionSnapshot | null
  mountPath: string | null
  pendingConfirmations: readonly PendingConfirmationSnapshot[]
  phase: RuntimePhase
  reachability: Reachability
  timers: readonly TimerSnapshot[]
  transportDiagnostic: DeviceTransportDiagnostic | null
  transportIssue: DeviceTransportIssue | null
  transportState: DeviceTransportState
}>

const INITIAL_SNAPSHOT: ApplicationSnapshot = {
  appState: 'unknown',
  attentionSession: null,
  auditRecords: [],
  backgroundRuntimeEnabled: false,
  capabilities: [],
  controlMode: 'ask_every_time',
  defaultDeviceId: null,
  deviceId: null,
  error: null,
  gatewayOrigin: null,
  installationId: null,
  mediaSession: null,
  mountPath: null,
  pendingConfirmations: [],
  phase: 'loading',
  reachability: 'unconfigured',
  timers: [],
  transportDiagnostic: null,
  transportIssue: null,
  transportState: 'unconfigured',
}

export class ApplicationRuntime {
  readonly #listeners = new Set<() => void>()
  #attentionController: AttentionSessionController | null = null
  #auditRevision = 0
  #auditRepository: SqliteAuditRepository | null = null
  #backgroundRuntimeRepository: SqliteBackgroundRuntimeRepository | null = null
  #systemAdapter: SystemAdapter | null = null
  #commandRepository: SqliteCommandRepository | null = null
  #confirmationRevision = 0
  #confirmationCoordinator: LocalConfirmationCoordinator | null = null
  #controlModeRepository: SqliteControlModeRepository | null = null
  #defaultDeviceId: string | null = null
  #deviceCredentialStore: SecureDeviceCredentialStore | null = null
  #deviceTransport: SdkDeviceTransport | null = null
  #gatewayConfigurationController: ManualGatewayConfigurationController | null = null
  #initialization: Promise<void> | null = null
  #installationId: string | null = null
  #localCommandExecutor: LocalCommandExecutor | null = null
  #mediaController: MediaSessionController | null = null
  #notificationController: LocalNotificationController | null = null
  #registry: CapabilityRegistry | null = null
  #snapshot = INITIAL_SNAPSHOT
  #timerController: LocalTimerController | null = null
  #timerReconciliation: Promise<void> = Promise.resolve()
  #transportRevision = 0

  getSnapshot = (): ApplicationSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  initialize(): Promise<void> {
    this.#initialization ??= this.#initializeOnce()
    return this.#initialization
  }

  async executeLocalCommand(command: unknown, signal: AbortSignal): Promise<CommandOutcome> {
    if (this.#localCommandExecutor === null) throw new Error('运行时尚未初始化')
    const outcome = await this.#localCommandExecutor.execute(command, signal)
    // outcome 已是 executor 归一化的结果（成功或结构化失败）。刷新只更新本地 UI 快照，
    // 属于 executor 之外的副产物；它若抛错绝不能把命令 handler 变成裸 rejection——那会让网关只看到
    // 黑盒的 “device handler failed”，既隐藏真实 outcome，也让 Agent 无法判断命令是否已产生副作用。
    try {
      await this.refresh()
    } catch {
      // 保留已产出的 outcome，只把刷新失败作为本地 UI 提示，而不是丢给网关一个裸 handler rejection。
      this.#publish({
        ...this.#snapshot,
        error: '命令已执行，但刷新本地状态失败；显示的活动/能力信息可能暂时过期。',
      })
    }
    return outcome
  }

  approveConfirmation(commandId: string): boolean {
    return this.#confirmationCoordinator?.approve(commandId) ?? false
  }

  rejectConfirmation(commandId: string): boolean {
    return this.#confirmationCoordinator?.reject(commandId) ?? false
  }

  async stopAttentionSession(): Promise<void> {
    if (this.#attentionController === null) throw new Error('运行时尚未初始化')
    await this.#attentionController.stop()
    await this.refresh()
  }

  async pauseMediaSession(sessionId: string): Promise<void> {
    if (this.#mediaController === null) throw new Error('运行时尚未初始化')
    await this.#mediaController.pause(sessionId)
    await this.refresh()
  }

  async resumeMediaSession(sessionId: string): Promise<void> {
    if (this.#mediaController === null) throw new Error('运行时尚未初始化')
    await this.#mediaController.resume(sessionId)
    await this.refresh()
  }

  async stopMediaSession(sessionId?: string): Promise<void> {
    if (this.#mediaController === null) throw new Error('运行时尚未初始化')
    await this.#mediaController.stop(sessionId)
    await this.refresh()
  }

  async requestNotificationPermission(): Promise<void> {
    if (this.#notificationController === null) throw new Error('运行时尚未初始化')
    try {
      await this.#notificationController.requestPermission()
      await this.refresh()
    } catch {
      this.#publish({
        ...this.#snapshot,
        error: '无法完成通知权限请求。请稍后重试或在系统设置中调整。',
      })
    }
  }

  async openNotificationSettings(): Promise<void> {
    try {
      await Linking.openSettings()
    } catch {
      this.#publish({
        ...this.#snapshot,
        error: '无法打开系统设置。请手动打开 App 的通知设置。',
      })
    }
  }

  async cancelTimer(timerId: string): Promise<void> {
    if (this.#timerController === null) throw new Error('运行时尚未初始化')
    try {
      await this.#timerController.cancelLocal(timerId)
      await this.refresh()
    } catch {
      this.#publish({
        ...this.#snapshot,
        error: '无法确认计时器已取消；系统状态仍可能不明确。',
      })
    }
  }

  async clearAuditHistory(): Promise<number> {
    if (this.#auditRepository === null) throw new Error('运行时尚未初始化')
    // 先使已开始的 refresh 失效，避免它在 DELETE 后发布删除前读到的旧列表。
    this.#auditRevision += 1
    const deleted = await this.#auditRepository.clear()
    await this.refresh()
    return deleted
  }

  async saveGatewayConfiguration(input: ManualGatewayConfigurationInput): Promise<void> {
    if (
      this.#gatewayConfigurationController === null
      || this.#deviceTransport === null
      || this.#controlModeRepository === null
    ) throw new Error('运行时尚未初始化')

    await this.#gatewayConfigurationController.save(input)
    const disabled = (await this.#controlModeRepository.get()) === 'disabled'
    await this.#deviceTransport.updateLifecycle(currentRuntimeAppState(), !disabled)
    await this.refresh()
  }

  async clearGatewayConfiguration(): Promise<void> {
    if (
      this.#gatewayConfigurationController === null
      || this.#deviceTransport === null
      || this.#controlModeRepository === null
    ) throw new Error('运行时尚未初始化')

    await this.#gatewayConfigurationController.clear()
    const disabled = (await this.#controlModeRepository.get()) === 'disabled'
    await this.#deviceTransport.updateLifecycle(currentRuntimeAppState(), !disabled)
    await this.refresh()
  }

  handleAppStateChange(appState: string): Promise<void> {
    this.#timerReconciliation = this.#timerReconciliation.then(async () => {
      await this.initialize()
      const disabled = (await this.#controlModeRepository?.get()) === 'disabled'
      if (appState === 'active' && this.#timerController !== null) {
        await this.#timerController.reconcile(disabled)
      }
      await this.#deviceTransport?.updateLifecycle(appState, !disabled)
      await this.refresh()
    }).catch(async () => { await this.refresh() })
    return this.#timerReconciliation
  }

  async setControlMode(controlMode: ControlMode): Promise<void> {
    if (this.#controlModeRepository === null) throw new Error('运行时尚未初始化')
    if (controlMode === 'disabled') {
      await this.emergencyDisable()
      return
    }
    await this.#controlModeRepository.set(controlMode, new Date().toISOString())
    await this.#deviceTransport?.updateLifecycle(currentRuntimeAppState(), true)
    await this.refresh()
  }

  async setBackgroundRuntimeEnabled(enabled: boolean): Promise<void> {
    if (this.#backgroundRuntimeRepository === null) throw new Error('运行时尚未初始化')
    await this.#backgroundRuntimeRepository.set(enabled, new Date().toISOString())
    await this.#applyBackgroundRuntime(enabled)
    await this.refresh()
  }

  async #applyBackgroundRuntime(enabled: boolean): Promise<void> {
    if (this.#systemAdapter === null) return
    try {
      if (enabled) await this.#systemAdapter.startBackgroundRuntime()
      else await this.#systemAdapter.stopBackgroundRuntime()
    } catch {
      this.#publish({
        ...this.#snapshot,
        error: '无法切换后台运行服务；系统可能限制了前台服务。',
      })
    }
  }

  async emergencyDisable(): Promise<EmergencyDisableResult> {
    if (this.#controlModeRepository === null) throw new Error('运行时尚未初始化')
    await this.#controlModeRepository.set('disabled', new Date().toISOString())
    const cancelledCommands = this.#localCommandExecutor?.cancelAll() ?? 0
    this.#confirmationCoordinator?.rejectAll('disabled')
    const stops = await Promise.allSettled([
      this.#attentionController?.stop(),
      this.#mediaController?.stop(),
      this.#timerController?.stopAll(),
      this.#deviceTransport?.updateLifecycle(currentRuntimeAppState(), false),
      this.#systemAdapter?.stopBackgroundRuntime(),
    ])
    await this.refresh()
    const timerStopFailures = stops[2]?.status === 'fulfilled'
      ? (stops[2].value ?? 0)
      : 0
    return {
      cancelledCommands,
      localEffectStopFailures: stops.filter(result => result.status === 'rejected').length
        + timerStopFailures,
    }
  }

  async refresh(): Promise<void> {
    if (
      this.#auditRepository === null
      || this.#controlModeRepository === null
      || this.#installationId === null
      || this.#registry === null
    ) return

    const auditRevision = this.#auditRevision
    const confirmationRevision = this.#confirmationRevision
    const transportRevision = this.#transportRevision
    const controlMode = await this.#controlModeRepository.get()
    const context = this.#context(controlMode)
    const transport = this.#deviceTransport?.getSnapshot() ?? {
      diagnostic: null,
      deviceId: null,
      gatewayOrigin: null,
      issue: null,
      mountPath: null,
      state: 'unconfigured' as const,
    }
    const [capabilities, auditRecords, timers, backgroundRuntimeEnabled] = await Promise.all([
      this.#registry.snapshot(context),
      this.#auditRepository.listRecent(ACTIVITY_HISTORY_DISPLAY_LIMIT),
      this.#timerController?.getVisibleTimers() ?? Promise.resolve([]),
      this.#backgroundRuntimeRepository?.get() ?? Promise.resolve(false),
    ])
    if (
      auditRevision !== this.#auditRevision
      || confirmationRevision !== this.#confirmationRevision
      || transportRevision !== this.#transportRevision
    ) return
    this.#publish({
      appState: context.appState,
      attentionSession: this.#attentionController?.getActiveSession() ?? null,
      auditRecords,
      backgroundRuntimeEnabled,
      capabilities,
      controlMode,
      defaultDeviceId: this.#defaultDeviceId,
      deviceId: transport.deviceId,
      error: null,
      gatewayOrigin: transport.gatewayOrigin,
      installationId: this.#installationId,
      mediaSession: this.#mediaController?.getSession() ?? null,
      mountPath: transport.mountPath,
      pendingConfirmations: this.#confirmationCoordinator?.getPending() ?? [],
      phase: 'ready',
      reachability: context.reachability,
      timers,
      transportDiagnostic: transport.diagnostic,
      transportIssue: transport.issue,
      transportState: transport.state,
    })
  }

  async #initializeOnce(): Promise<void> {
    try {
      const database = await MobileDatabase.open()
      const identityStore = new SecureInstallationIdentityStore()
      this.#installationId = await identityStore.getOrCreate()
      this.#defaultDeviceId = await resolveDefaultDeviceId(this.#installationId)
      this.#auditRepository = new SqliteAuditRepository(database)
      this.#commandRepository = new SqliteCommandRepository(database)
      this.#controlModeRepository = new SqliteControlModeRepository(database)
      await this.#commandRepository.recoverInterrupted(new Date().toISOString())
      await this.#auditRepository.prune(LOCAL_AUDIT_RETENTION_LIMIT)

      this.#registry = new CapabilityRegistry()
      const appHandoffController = new AppHandoffController(
        new ExpoAppLinkingAdapter(),
        ExpoConfigHosts.read('linkHosts'),
      )
      this.#registry.register(createCanOpenUrlCapability(appHandoffController))
      this.#registry.register(createOpenUrlCapability(appHandoffController))
      this.#attentionController = new AttentionSessionController(
        new NativeAttentionHapticsAdapter(),
        {
          flash: new NativeAttentionFlashAdapter(),
          sound: new ExpoAttentionSoundAdapter(),
        },
      )
      this.#attentionController.subscribe(() => { void this.refresh() })
      this.#registry.register(createAttentionRingCapability(this.#attentionController))
      this.#registry.register(createAttentionStopCapability(this.#attentionController))
      this.#registry.register(createCurrentLocationCapability(
        new CurrentLocationController(new ExpoCurrentLocationAdapter()),
      ))
      this.#registry.register(createOpenMapCapability(
        new OpenMapController(new ExpoMapHandoffAdapter()),
      ))
      const notificationAdapter = new ExpoLocalNotificationAdapter()
      this.#notificationController = new LocalNotificationController(notificationAdapter)
      await this.#notificationController.initialize()
      this.#registry.register(createLocalNotificationCapability(this.#notificationController))
      const timerRepository = new SqliteTimerRepository(database)
      this.#timerController = new LocalTimerController(timerRepository, notificationAdapter)
      const initialControlMode = await this.#controlModeRepository.get()
      await this.#timerController.reconcile(initialControlMode === 'disabled')
      await this.#commandRepository.pruneTerminal(LOCAL_COMMAND_RETENTION_LIMIT)
      this.#registry.register(createTimerStartCapability(this.#timerController))
      this.#registry.register(createTimerCancelCapability(this.#timerController))
      this.#registry.register(createTimerStatusCapability(this.#timerController))
      this.#timerController.subscribe(() => { void this.refresh() })
      const configuredMediaHosts = ExpoConfigHosts.read('mediaHosts')
      this.#mediaController = new MediaSessionController(
        new ExpoAudioPlaybackPortFactory(),
        configuredMediaHosts,
        new BoundedMediaSourceResolver(
          (url, init) => expoFetch(url, init),
          new ExpoMediaCacheStore(),
        ),
      )
      this.#mediaController.subscribe(() => { void this.refresh() })
      this.#registry.register(createMediaPlayCapability(this.#mediaController))
      this.#registry.register(createMediaPauseCapability(this.#mediaController))
      this.#registry.register(createMediaResumeCapability(this.#mediaController))
      this.#registry.register(createMediaSeekCapability(this.#mediaController))
      this.#registry.register(createMediaStopCapability(this.#mediaController))
      this.#registry.register(createMediaStatusCapability(this.#mediaController))
      this.#registry.register(createStatusCapability(new ExpoStatusProbe()))
      const systemAdapter = new NativeSystemAdapter()
      this.#systemAdapter = systemAdapter
      this.#backgroundRuntimeRepository = new SqliteBackgroundRuntimeRepository(database)
      this.#registry.register(createExecShellCapability(systemAdapter))
      this.#registry.register(createClipboardGetCapability(systemAdapter))
      this.#registry.register(createClipboardSetCapability(systemAdapter))
      this.#registry.register(createOpenIntentCapability(systemAdapter))
      this.#registry.register(createAccessibilityStatusCapability(systemAdapter))
      this.#confirmationCoordinator = new LocalConfirmationCoordinator()
      this.#confirmationCoordinator.subscribe(() => {
        this.#confirmationRevision += 1
        void this.refresh()
      })

      const policyEngine = new PolicyEngine()
      this.#localCommandExecutor = new LocalCommandExecutor({
        auditRepository: this.#auditRepository,
        commandRepository: this.#commandRepository,
        confirmationCoordinator: this.#confirmationCoordinator,
        context: async () => {
          if (this.#controlModeRepository === null) throw new Error('运行时尚未初始化')
          return this.#context(await this.#controlModeRepository.get())
        },
        policyEngine,
        registry: this.#registry,
      })
      const runtimeCapabilityDependencies = {
        confirmationCoordinator: this.#confirmationCoordinator,
        executor: this.#localCommandExecutor,
        policyEngine,
        registry: this.#registry,
      }
      this.#registry.register(createRuntimeCapabilitiesCapability(runtimeCapabilityDependencies))
      this.#registry.register(createRuntimePendingCommandsCapability(runtimeCapabilityDependencies))
      this.#registry.register(createRuntimeCancelCapability(runtimeCapabilityDependencies))
      this.#deviceCredentialStore = new SecureDeviceCredentialStore()
      const storedCredential = await this.#deviceCredentialStore.get()
      this.#deviceTransport = new SdkDeviceTransport({
        baseUrl: storedCredential?.audienceOrigin ?? ExpoConfigHosts.gatewayOrigin(),
        credentialStore: this.#deviceCredentialStore,
        executeCommand: (command, signal) => this.executeLocalCommand(command, signal),
        onSnapshotChange: () => {
          this.#transportRevision += 1
          void this.refresh()
        },
        registry: this.#registry,
      })
      this.#gatewayConfigurationController = new ManualGatewayConfigurationController({
        buildGatewayOrigin: ExpoConfigHosts.gatewayOrigin(),
        credentialStore: this.#deviceCredentialStore,
        defaultDeviceId: this.#defaultDeviceId,
        installationId: this.#installationId,
        transport: this.#deviceTransport,
      })
      await this.#deviceTransport.updateLifecycle(
        currentRuntimeAppState(),
        initialControlMode !== 'disabled',
      )
      if (initialControlMode !== 'disabled' && await this.#backgroundRuntimeRepository.get()) {
        await this.#applyBackgroundRuntime(true)
      }
      await this.refresh()
    } catch {
      this.#publish({
        ...INITIAL_SNAPSHOT,
        error: '本地运行时初始化失败。请重启 App；若问题持续，请清除本地数据后重新配对。',
        phase: 'error',
      })
    }
  }

  #context(controlMode: ControlMode): CapabilityContext {
    if (this.#installationId === null) throw new Error('installationId 尚未初始化')
    return {
      appState: currentRuntimeAppState(),
      controlMode,
      installationId: this.#installationId,
      reachability: this.#reachability(controlMode),
    }
  }

  #reachability(controlMode: ControlMode): Reachability {
    if (controlMode === 'disabled') return 'disabled'
    const state = this.#deviceTransport?.getSnapshot().state ?? 'unconfigured'
    if (state === 'ready') return 'online'
    if (state === 'unconfigured' || state === 'credentials_required') return 'unconfigured'
    return 'offline'
  }

  #publish(snapshot: ApplicationSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}

class ExpoConfigHosts {
  static gatewayOrigin(): string | null {
    const value: unknown = Constants.expoConfig?.extra?.gatewayOrigin
    return typeof value === 'string' ? value : null
  }

  static read(key: 'linkHosts' | 'mediaHosts'): ReadonlySet<string> {
    const value: unknown = Constants.expoConfig?.extra?.[key]
    if (!Array.isArray(value) || !value.every(host => typeof host === 'string')) return new Set()
    return new Set(value)
  }
}

export const applicationRuntime = new ApplicationRuntime()
