import { router, useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'

export default function SettingsRoute() {
  const focused = useIsFocused()
  const { setControlMode, snapshot } = useRuntime()
  return (
    <SettingsScreen
      focused={focused}
      onEmergencyDisable={() => { void setControlMode('disabled') }}
      onEnable={() => { void setControlMode('ask_every_time') }}
      onOpenCapabilities={() => { router.navigate('/capabilities') }}
      onOpenConnection={() => { router.navigate('/connection') }}
      onOpenControls={() => { router.navigate('/controls') }}
      onOpenMedia={() => { router.navigate('/media') }}
      onOpenStatus={() => { router.navigate('/status') }}
      snapshot={snapshot}
    />
  )
}
