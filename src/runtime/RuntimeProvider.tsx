import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import {
  applicationRuntime,
  type ApplicationRuntime,
  type ApplicationSnapshot,
} from './applicationRuntime'

import type {
  CameraCaptureFailure,
  CapturedCameraPhoto,
} from '@/capabilities/camera/captureCoordinator'
import type { ControlMode } from '@/commands/types'
import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'
import type { ResolvedInboxImage } from '@/inbox/imageSource'
import type { InboxViewOptions } from '@/inbox/types'


const RuntimeContext = createContext<ApplicationRuntime | null>(null)

export function RuntimeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    void applicationRuntime.initialize()
    const subscription = AppState.addEventListener('change', appState => {
      void applicationRuntime.handleAppStateChange(appState)
    })
    return () => subscription.remove()
  }, [])

  return (
    <RuntimeContext.Provider value={applicationRuntime}>
      {children}
    </RuntimeContext.Provider>
  )
}

export function useRuntime(): Readonly<{
  approveConfirmation(commandId: string): boolean
  cancelTimer(timerId: string): Promise<void>
  clearAuditHistory(): Promise<number>
  clearGatewayConfiguration(): Promise<void>
  clearInbox(): Promise<number>
  failCameraCapture(commandId: string, failure: CameraCaptureFailure): boolean
  markAllInboxMessagesRead(): Promise<number>
  markInboxMessageRead(messageId: string): Promise<void>
  openCameraSettings(): Promise<void>
  openInboxLink(rawUrl: string): Promise<void>
  openNotificationSettings(): Promise<void>
  pauseMediaSession(sessionId: string): Promise<void>
  rejectConfirmation(commandId: string): boolean
  requestNotificationPermission(): Promise<void>
  requestCameraPermission(): Promise<void>
  resolveInboxImage(rawUrl: string, signal: AbortSignal): Promise<ResolvedInboxImage>
  setBackgroundRuntimeEnabled(enabled: boolean): Promise<void>
  resumeMediaSession(sessionId: string): Promise<void>
  saveGatewayConfiguration(input: ManualGatewayConfigurationInput): Promise<void>
  setControlMode(mode: ControlMode): Promise<void>
  setInboxViewOptions(options: InboxViewOptions): Promise<void>
  snapshot: ApplicationSnapshot
  stopAttentionSession(): Promise<void>
  stopMediaSession(sessionId?: string): Promise<void>
  submitCameraCapture(commandId: string, photo: CapturedCameraPhoto): boolean
}> {
  const runtime = useContext(RuntimeContext)
  if (runtime === null) throw new Error('useRuntime 必须在 RuntimeProvider 内使用')
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )
  return {
    approveConfirmation: commandId => runtime.approveConfirmation(commandId),
    cancelTimer: timerId => runtime.cancelTimer(timerId),
    clearAuditHistory: () => runtime.clearAuditHistory(),
    clearGatewayConfiguration: () => runtime.clearGatewayConfiguration(),
    clearInbox: () => runtime.clearInbox(),
    failCameraCapture: (commandId, failure) => runtime.failCameraCapture(commandId, failure),
    markAllInboxMessagesRead: () => runtime.markAllInboxMessagesRead(),
    markInboxMessageRead: messageId => runtime.markInboxMessageRead(messageId),
    openCameraSettings: () => runtime.openCameraSettings(),
    openInboxLink: rawUrl => runtime.openInboxLink(rawUrl),
    openNotificationSettings: () => runtime.openNotificationSettings(),
    pauseMediaSession: sessionId => runtime.pauseMediaSession(sessionId),
    rejectConfirmation: commandId => runtime.rejectConfirmation(commandId),
    requestCameraPermission: () => runtime.requestCameraPermission(),
    requestNotificationPermission: () => runtime.requestNotificationPermission(),
    resolveInboxImage: (rawUrl, signal) => runtime.resolveInboxImage(rawUrl, signal),
    setBackgroundRuntimeEnabled: enabled => runtime.setBackgroundRuntimeEnabled(enabled),
    resumeMediaSession: sessionId => runtime.resumeMediaSession(sessionId),
    saveGatewayConfiguration: input => runtime.saveGatewayConfiguration(input),
    setControlMode: mode => runtime.setControlMode(mode),
    setInboxViewOptions: options => runtime.setInboxViewOptions(options),
    snapshot,
    stopAttentionSession: () => runtime.stopAttentionSession(),
    stopMediaSession: sessionId => runtime.stopMediaSession(sessionId),
    submitCameraCapture: (commandId, photo) => runtime.submitCameraCapture(commandId, photo),
  }
}
