import { router, useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { HomeScreen } from '@/ui/screens/HomeScreen'

export default function HomeRoute() {
  const focused = useIsFocused()
  const { cancelTimer, snapshot, stopAttentionSession } = useRuntime()
  return (
    <HomeScreen
      focused={focused}
      onCancelTimer={timerId => { void cancelTimer(timerId) }}
      onOpenSettings={() => { router.navigate('/settings') }}
      onStopAttention={() => { void stopAttentionSession() }}
      snapshot={snapshot}
    />
  )
}
