import { router, useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { ConnectionSettingsScreen } from '@/ui/screens/ConnectionSettingsScreen'

export default function ConnectionSettingsRoute() {
  const focused = useIsFocused()
  const { clearGatewayConfiguration, saveGatewayConfiguration, snapshot } = useRuntime()
  return (
    <ConnectionSettingsScreen
      focused={focused}
      onBack={() => { router.back() }}
      onClear={clearGatewayConfiguration}
      onSave={saveGatewayConfiguration}
      snapshot={snapshot}
    />
  )
}
