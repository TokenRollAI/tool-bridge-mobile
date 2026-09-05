import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { RuntimeProvider, useRuntime } from '@/runtime/RuntimeProvider'
import { CameraCaptureModal } from '@/ui/components/CameraCaptureModal'
import { PendingConfirmationModal } from '@/ui/components/PendingConfirmationModal'
import { useTheme } from '@/ui/theme'

export default function RootLayout() {
  return (
    <RuntimeProvider>
      <RootContent />
    </RuntimeProvider>
  )
}

function RootContent() {
  const { colors, isDark } = useTheme()
  const {
    approveConfirmation,
    failCameraCapture,
    rejectConfirmation,
    snapshot,
    submitCameraCapture,
  } = useRuntime()
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }} />
      <PendingConfirmationModal
        confirmations={snapshot.pendingConfirmations}
        onApprove={approveConfirmation}
        onReject={rejectConfirmation}
      />
      <CameraCaptureModal
        key={snapshot.cameraCaptureRequest?.commandId ?? 'camera:none'}
        onFail={failCameraCapture}
        onSubmit={submitCameraCapture}
        request={snapshot.cameraCaptureRequest}
      />
    </>
  )
}
