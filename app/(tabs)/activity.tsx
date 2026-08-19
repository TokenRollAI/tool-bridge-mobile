import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { ActivityScreen } from '@/ui/screens/ActivityScreen'

export default function ActivityRoute() {
  const focused = useIsFocused()
  const { clearAuditHistory, snapshot } = useRuntime()
  return (
    <ActivityScreen
      focused={focused}
      onClearAuditHistory={clearAuditHistory}
      records={snapshot.auditRecords}
    />
  )
}
