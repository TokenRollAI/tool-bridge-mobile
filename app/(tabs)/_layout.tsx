import { Tabs } from 'expo-router'
import { Platform } from 'react-native'

import { Icon } from '@/ui/components/Icon'
import { TAB_ICONS, TAB_OPTIONS } from '@/ui/navigation'
import { colors } from '@/ui/theme'

import type { IconName } from '@/ui/components/Icon'
import type { ColorValue } from 'react-native'

function tabIcon(inactive: IconName, active: IconName) {
  return function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon color={String(color)} name={focused ? active : inactive} size={24} />
  }
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          elevation: 0,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 6,
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
        name="capabilities"
        options={{
          ...TAB_OPTIONS.capabilities,
          tabBarIcon: tabIcon(TAB_ICONS.capabilities.inactive, TAB_ICONS.capabilities.active),
        }}
      />
      <Tabs.Screen
        name="media"
        options={{
          ...TAB_OPTIONS.media,
          tabBarIcon: tabIcon(TAB_ICONS.media.inactive, TAB_ICONS.media.active),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          ...TAB_OPTIONS.activity,
          tabBarIcon: tabIcon(TAB_ICONS.activity.inactive, TAB_ICONS.activity.active),
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
