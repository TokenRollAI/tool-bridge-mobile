import { router, useIsFocused, useLocalSearchParams } from 'expo-router'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { InboxMessageScreen } from '@/ui/screens/InboxMessageScreen'

export default function InboxMessageRoute() {
  const focused = useIsFocused()
  const { messageId } = useLocalSearchParams<{ messageId: string }>()
  const { markInboxMessageRead, openInboxLink, resolveInboxImage, snapshot } = useRuntime()
  const message = snapshot.inboxMessages.find(item => item.messageId === messageId) ?? null
  return (
    <InboxMessageScreen
      focused={focused}
      message={message}
      onBack={() => { router.back() }}
      onMarkRead={markInboxMessageRead}
      onOpenLink={openInboxLink}
      onResolveImage={resolveInboxImage}
    />
  )
}
