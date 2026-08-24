import { router, useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'

export default function SettingsRoute() {
  const focused = useIsFocused()
  const {
    clearGatewayConfiguration,
    openCameraSettings,
    openNotificationSettings,
    requestCameraPermission,
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
      onOpenCapabilities={() => { router.navigate('/capabilities') }}
      onOpenCameraSettings={() => { void openCameraSettings() }}
      onOpenMedia={() => { router.navigate('/media') }}
      onOpenNotificationSettings={() => { void openNotificationSettings() }}
      onOpenStatus={() => { router.navigate('/status') }}
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onRequestCameraPermission={() => { void requestCameraPermission() }}
      onSaveGatewayConfiguration={saveGatewayConfiguration}
      onSetBackgroundRuntime={enabled => { void setBackgroundRuntimeEnabled(enabled) }}
      onSetControlMode={mode => { void setControlMode(mode) }}
      snapshot={snapshot}
    />
  )
}
