import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { HomeScreen } from '@/ui/screens/HomeScreen'

export default function HomeRoute() {
  const focused = useIsFocused()
  const {
    approveConfirmation,
    cancelTimer,
    openNotificationSettings,
    rejectConfirmation,
    requestNotificationPermission,
    setControlMode,
    snapshot,
    stopAttentionSession,
  } = useRuntime()
  return (
    <HomeScreen
      focused={focused}
      onEmergencyDisable={() => { void setControlMode('disabled') }}
      onCancelTimer={timerId => { void cancelTimer(timerId) }}
      onEnable={() => { void setControlMode('ask_every_time') }}
      onOpenNotificationSettings={() => { void openNotificationSettings() }}
      onApproveConfirmation={approveConfirmation}
      onRejectConfirmation={rejectConfirmation}
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onStopAttention={() => { void stopAttentionSession() }}
      snapshot={snapshot}
    />
  )
}
