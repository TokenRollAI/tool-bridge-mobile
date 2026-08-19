import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { RuntimeProvider } from '@/runtime/RuntimeProvider'
import { colors } from '@/ui/theme'

export default function RootLayout() {
  return (
    <RuntimeProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }} />
    </RuntimeProvider>
  )
}
