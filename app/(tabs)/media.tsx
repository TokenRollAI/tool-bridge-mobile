import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { MediaScreen } from '@/ui/screens/MediaScreen'

export default function MediaRoute() {
  const focused = useIsFocused()
  const {
    pauseMediaSession,
    resumeMediaSession,
    snapshot,
    stopMediaSession,
  } = useRuntime()
  return (
    <MediaScreen
      focused={focused}
      onPause={sessionId => { void pauseMediaSession(sessionId) }}
      onResume={sessionId => { void resumeMediaSession(sessionId) }}
      onStop={sessionId => { void stopMediaSession(sessionId) }}
      session={snapshot.mediaSession}
    />
  )
}
