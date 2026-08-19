import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { CapabilitiesScreen } from '@/ui/screens/CapabilitiesScreen'

export default function CapabilitiesRoute() {
  const focused = useIsFocused()
  const { snapshot } = useRuntime()
  return <CapabilitiesScreen capabilities={snapshot.capabilities} focused={focused} />
}
