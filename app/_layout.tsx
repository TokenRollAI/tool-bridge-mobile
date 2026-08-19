import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { RuntimeProvider, useRuntime } from '@/runtime/RuntimeProvider'
import { PendingConfirmationModal } from '@/ui/components/PendingConfirmationModal'
import { colors } from '@/ui/theme'

export default function RootLayout() {
  return (
    <RuntimeProvider>
      <RootContent />
    </RuntimeProvider>
  )
}

function RootContent() {
  const { approveConfirmation, rejectConfirmation, snapshot } = useRuntime()
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }} />
      <PendingConfirmationModal
        confirmations={snapshot.pendingConfirmations}
        onApprove={approveConfirmation}
        onReject={rejectConfirmation}
      />
    </>
  )
}
