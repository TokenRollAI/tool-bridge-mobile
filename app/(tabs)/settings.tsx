import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'

export default function SettingsRoute() {
  const focused = useIsFocused()
  const {
    clearGatewayConfiguration,
    openNotificationSettings,
    requestNotificationPermission,
    saveGatewayConfiguration,
    setBackgroundRuntimeEnabled,
    setControlMode,
    snapshot,
  } = useRuntime()
  return (
    <SettingsScreen
      focused={focused}
      onClearGatewayConfiguration={clearGatewayConfiguration}
      onEmergencyDisable={() => { void setControlMode('disabled') }}
      onEnable={() => { void setControlMode('ask_every_time') }}
      onOpenNotificationSettings={() => { void openNotificationSettings() }}
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onSaveGatewayConfiguration={saveGatewayConfiguration}
      onSetBackgroundRuntime={enabled => { void setBackgroundRuntimeEnabled(enabled) }}
      onSetControlMode={mode => { void setControlMode(mode) }}
      snapshot={snapshot}
    />
  )
}
