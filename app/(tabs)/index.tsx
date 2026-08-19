import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { HomeScreen } from '@/ui/screens/HomeScreen'

export default function HomeRoute() {
  const focused = useIsFocused()
  const {
    cancelTimer,
    clearGatewayConfiguration,
    openNotificationSettings,
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
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onSaveGatewayConfiguration={saveGatewayConfiguration}
      onStopAttention={() => { void stopAttentionSession() }}
      snapshot={snapshot}
    />
  )
}
