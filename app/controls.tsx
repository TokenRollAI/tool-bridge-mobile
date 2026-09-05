import { router, useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { ControlSettingsScreen } from '@/ui/screens/ControlSettingsScreen'

export default function ControlSettingsRoute() {
  const focused = useIsFocused()
  const {
    openCameraSettings,
    openNotificationSettings,
    requestCameraPermission,
    requestNotificationPermission,
    setBackgroundRuntimeEnabled,
    setControlMode,
    snapshot,
  } = useRuntime()
  return (
    <ControlSettingsScreen
      focused={focused}
      onBack={() => { router.back() }}
      onEmergencyDisable={() => { void setControlMode('disabled') }}
      onEnable={() => { void setControlMode('ask_every_time') }}
      onOpenCameraSettings={() => { void openCameraSettings() }}
      onOpenNotificationSettings={() => { void openNotificationSettings() }}
      onRequestNotificationPermission={() => { void requestNotificationPermission() }}
      onRequestCameraPermission={() => { void requestCameraPermission() }}
      onSetBackgroundRuntime={enabled => { void setBackgroundRuntimeEnabled(enabled) }}
      onSetControlMode={mode => { void setControlMode(mode) }}
      snapshot={snapshot}
    />
  )
}
