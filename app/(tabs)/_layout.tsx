import { Tabs } from 'expo-router/js-tabs'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useRuntime } from '@/runtime/RuntimeProvider'
import { Icon } from '@/ui/components/Icon'
import { TAB_ICONS, TAB_OPTIONS, inboxTabAccessibilityLabel } from '@/ui/navigation'
import { radius, useTheme } from '@/ui/theme'

import type { IconName } from '@/ui/components/Icon'
import type { ColorValue } from 'react-native'

function tabIcon(inactive: IconName, active: IconName, unreadColor?: string) {
  return function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon color={String(color)} name={focused ? active : inactive} size={20} />
        {unreadColor === undefined ? null : <View style={[styles.unreadDot, { backgroundColor: unreadColor }]} />}
      </View>
    )
  }
}

export default function TabsLayout() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  // 导航器也使用此底边距计算键盘出现时的隐藏位移。
  const bottomInset = Math.max(insets.bottom, 12)
  const { snapshot: { inboxUnreadCount } } = useRuntime()
  return (
    <Tabs
      safeAreaInsets={{ bottom: bottomInset }}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveBackgroundColor: colors.primarySoft,
        tabBarActiveTintColor: colors.text,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: colors.muted,
        tabBarItemStyle: styles.item,
        tabBarLabelPosition: 'beside-icon',
        tabBarLabelStyle: styles.label,
        tabBarStyle: [
          styles.bar,
          {
            backgroundColor: colors.slab,
            borderColor: colors.border,
            marginBottom: bottomInset,
            marginLeft: 24 + insets.left,
            marginRight: 24 + insets.right,
          },
        ],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          ...TAB_OPTIONS.index,
          tabBarAccessibilityLabel: inboxTabAccessibilityLabel(inboxUnreadCount),
          tabBarIcon: tabIcon(TAB_ICONS.index.inactive, TAB_ICONS.index.active, inboxUnreadCount > 0 ? colors.signal : undefined),
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

const styles = StyleSheet.create({
  bar: {
    borderRadius: radius.pill,
    borderWidth: 1,
    elevation: 0,
    height: 56,
    marginTop: 8,
    paddingBottom: 3,
    paddingHorizontal: 3,
    paddingTop: 3,
  },
  item: {
    borderRadius: radius.pill,
    marginHorizontal: 2,
    minHeight: 48,
    overflow: 'hidden',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  unreadDot: {
    borderRadius: radius.pill,
    height: 6,
    position: 'absolute',
    right: -3,
    top: 0,
    width: 6,
  },
})
