import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/ui/components/Icon'
import { TAB_ICONS, TAB_OPTIONS } from '@/ui/navigation'
import { useTheme } from '@/ui/theme'

import type { IconName } from '@/ui/components/Icon'
import type { ColorValue } from 'react-native'

function tabIcon(inactive: IconName, active: IconName) {
  return function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon color={String(color)} name={focused ? active : inactive} size={24} />
  }
}

export default function TabsLayout() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveBackgroundColor: colors.primarySoft,
        tabBarItemStyle: { borderRadius: 12, marginHorizontal: 8 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          elevation: 0,
          height: 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          ...TAB_OPTIONS.index,
          tabBarIcon: tabIcon(TAB_ICONS.index.inactive, TAB_ICONS.index.active),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          ...TAB_OPTIONS.settings,
          tabBarIcon: tabIcon(TAB_ICONS.settings.inactive, TAB_ICONS.settings.active),
        }}
      />
    </Tabs>
  )
}
