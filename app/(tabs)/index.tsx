import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { HomeScreen } from '@/ui/screens/HomeScreen'

export default function HomeRoute() {
  const focused = useIsFocused()
  const {
    approveConfirmation,
    cancelTimer,
    clearGatewayConfiguration,
    openNotificationSettings,
    rejectConfirmation,
    requestNotificationPermission,
    saveGatewayConfiguration,
    setControlMode,
    snapshot,
    stopAttentionSession,
  } = useRuntime()
  return (
    <HomeScreen
      focused={focused}
      onCancelTimer={timerId => { void cancelTimer(timerId) }}
      onClearGatewayConfiguration={clearGatewayConfiguration}
      onEmergencyDisable={() => { void setControlMode('disabled') }}
      onEnable={() => { void setControlMode('ask_every_time') }}
      onOpenNotificationSettings={() => { void openNotificationSettings() }}
      onApproveConfirmation={approveConfirmation}
      onRejectConfirmation={rejectConfirmation}
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onSaveGatewayConfiguration={saveGatewayConfiguration}
      onStopAttention={() => { void stopAttentionSession() }}
      snapshot={snapshot}
    />
  )
}
