import { Tabs } from 'expo-router'

import { TAB_OPTIONS } from '@/ui/navigation'
import { colors } from '@/ui/theme'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.outline,
        },
      }}
    >
      <Tabs.Screen name="index" options={TAB_OPTIONS.index} />
      <Tabs.Screen name="capabilities" options={TAB_OPTIONS.capabilities} />
      <Tabs.Screen name="media" options={TAB_OPTIONS.media} />
      <Tabs.Screen name="activity" options={TAB_OPTIONS.activity} />
    </Tabs>
  )
}
