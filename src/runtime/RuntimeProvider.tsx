import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import {
  applicationRuntime,
  type ApplicationRuntime,
  type ApplicationSnapshot,
} from './applicationRuntime'

import type { ControlMode } from '@/commands/types'


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
  openNotificationSettings(): Promise<void>
  pauseMediaSession(sessionId: string): Promise<void>
  rejectConfirmation(commandId: string): boolean
  requestNotificationPermission(): Promise<void>
  resumeMediaSession(sessionId: string): Promise<void>
  setControlMode(mode: ControlMode): Promise<void>
  snapshot: ApplicationSnapshot
  stopAttentionSession(): Promise<void>
  stopMediaSession(sessionId?: string): Promise<void>
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
    openNotificationSettings: () => runtime.openNotificationSettings(),
    pauseMediaSession: sessionId => runtime.pauseMediaSession(sessionId),
    rejectConfirmation: commandId => runtime.rejectConfirmation(commandId),
    requestNotificationPermission: () => runtime.requestNotificationPermission(),
    resumeMediaSession: sessionId => runtime.resumeMediaSession(sessionId),
    setControlMode: mode => runtime.setControlMode(mode),
    snapshot,
    stopAttentionSession: () => runtime.stopAttentionSession(),
    stopMediaSession: sessionId => runtime.stopMediaSession(sessionId),
  }
}
