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
import { NativeAttentionHapticsAdapter } from '@/capabilities/attention/hapticsAdapter'
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
import { currentRuntimeAppState, ExpoStatusProbe } from '@/capabilities/status/probe'
import { createStatusCapability } from '@/capabilities/status/statusCapability'
import { LOCAL_COMMAND_RETENTION_LIMIT } from '@/commands/repository'
import { SecureInstallationIdentityStore } from '@/identity/installationIdentityStore'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { SqliteAuditRepository } from '@/storage/auditRepository'
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
  RuntimeAppState,
} from '@/capabilities/types'
import type { CommandOutcome, ControlMode } from '@/commands/types'
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
  capabilities: readonly CapabilitySnapshot[]
  controlMode: ControlMode
  error: string | null
  installationId: string | null
  mediaSession: MediaSessionSnapshot | null
  pendingConfirmations: readonly PendingConfirmationSnapshot[]
  phase: RuntimePhase
  reachability: 'disabled' | 'unconfigured'
  timers: readonly TimerSnapshot[]
}>

const INITIAL_SNAPSHOT: ApplicationSnapshot = {
  appState: 'unknown',
  attentionSession: null,
  auditRecords: [],
  capabilities: [],
  controlMode: 'ask_every_time',
  error: null,
  installationId: null,
  mediaSession: null,
  pendingConfirmations: [],
  phase: 'loading',
  reachability: 'unconfigured',
  timers: [],
}

export class ApplicationRuntime {
  readonly #listeners = new Set<() => void>()
  #attentionController: AttentionSessionController | null = null
  #auditRevision = 0
  #auditRepository: SqliteAuditRepository | null = null
  #commandRepository: SqliteCommandRepository | null = null
  #confirmationCoordinator: LocalConfirmationCoordinator | null = null
  #controlModeRepository: SqliteControlModeRepository | null = null
  #initialization: Promise<void> | null = null
  #installationId: string | null = null
  #localCommandExecutor: LocalCommandExecutor | null = null
  #mediaController: MediaSessionController | null = null
  #notificationController: LocalNotificationController | null = null
  #registry: CapabilityRegistry | null = null
  #snapshot = INITIAL_SNAPSHOT
  #timerController: LocalTimerController | null = null
  #timerReconciliation: Promise<void> = Promise.resolve()

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
    await this.refresh()
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

  handleAppStateChange(appState: string): Promise<void> {
    this.#timerReconciliation = this.#timerReconciliation.then(async () => {
      await this.initialize()
      if (appState === 'active' && this.#timerController !== null) {
        const disabled = (await this.#controlModeRepository?.get()) === 'disabled'
        await this.#timerController.reconcile(disabled)
      }
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
    await this.refresh()
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
    const controlMode = await this.#controlModeRepository.get()
    const context = this.#context(controlMode)
    const [capabilities, auditRecords, timers] = await Promise.all([
      this.#registry.snapshot(context),
      this.#auditRepository.listRecent(ACTIVITY_HISTORY_DISPLAY_LIMIT),
      this.#timerController?.getVisibleTimers() ?? Promise.resolve([]),
    ])
    if (auditRevision !== this.#auditRevision) return
    this.#publish({
      appState: context.appState,
      attentionSession: this.#attentionController?.getActiveSession() ?? null,
      auditRecords,
      capabilities,
      controlMode,
      error: null,
      installationId: this.#installationId,
      mediaSession: this.#mediaController?.getSession() ?? null,
      pendingConfirmations: this.#confirmationCoordinator?.getPending() ?? [],
      phase: 'ready',
      reachability: context.reachability,
      timers,
    })
  }

  async #initializeOnce(): Promise<void> {
    try {
      const database = await MobileDatabase.open()
      const identityStore = new SecureInstallationIdentityStore()
      this.#installationId = await identityStore.getOrCreate()
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
      this.#attentionController = new AttentionSessionController(new NativeAttentionHapticsAdapter())
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
      this.#registry.register(createMediaStopCapability(this.#mediaController))
      this.#registry.register(createMediaStatusCapability(this.#mediaController))
      this.#registry.register(createStatusCapability(new ExpoStatusProbe()))
      this.#confirmationCoordinator = new LocalConfirmationCoordinator()
      this.#confirmationCoordinator.subscribe(() => { void this.refresh() })

      // 生产 transport 尚无已发布的上游契约；executor 只通过本地 registry/policy 边界构造。
      this.#localCommandExecutor = new LocalCommandExecutor({
        auditRepository: this.#auditRepository,
        commandRepository: this.#commandRepository,
        confirmationCoordinator: this.#confirmationCoordinator,
        context: async () => {
          if (this.#controlModeRepository === null) throw new Error('运行时尚未初始化')
          return this.#context(await this.#controlModeRepository.get())
        },
        policyEngine: new PolicyEngine(),
        registry: this.#registry,
      })
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
      reachability: controlMode === 'disabled' ? 'disabled' : 'unconfigured',
    }
  }

  #publish(snapshot: ApplicationSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}

class ExpoConfigHosts {
  static read(key: 'linkHosts' | 'mediaHosts'): ReadonlySet<string> {
    const value: unknown = Constants.expoConfig?.extra?.[key]
    if (!Array.isArray(value) || !value.every(host => typeof host === 'string')) return new Set()
    return new Set(value)
  }
}

export const applicationRuntime = new ApplicationRuntime()
