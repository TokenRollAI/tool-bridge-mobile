import { useIsFocused } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { InboxScreen } from '@/ui/screens/InboxScreen'

export default function InboxRoute() {
  const focused = useIsFocused()
  const {
    clearInbox,
    markAllInboxMessagesRead,
    markInboxMessageRead,
    resolveInboxImage,
    setInboxViewOptions,
    snapshot,
  } = useRuntime()
  return (
    <InboxScreen
      focused={focused}
      messages={snapshot.inboxMessages}
      onClearInbox={clearInbox}
      onMarkAllRead={markAllInboxMessagesRead}
      onMarkRead={markInboxMessageRead}
      onResolveImage={resolveInboxImage}
      onViewOptionsChange={setInboxViewOptions}
      unreadCount={snapshot.inboxUnreadCount}
      viewOptions={snapshot.inboxViewOptions}
    />
  )
}
