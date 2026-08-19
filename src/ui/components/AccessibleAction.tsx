import { forwardRef } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import { colors } from '@/ui/theme'

import type { StyleProp, TextStyle, ViewStyle } from 'react-native'

export const MINIMUM_ACCESSIBLE_TARGET_SIZE = 48

type AccessibleActionProps = Readonly<{
  accessibilityHint?: string
  busy?: boolean
  disabled?: boolean
  label: string
  onPress(): void
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  visualLabel?: string
}>

export const AccessibleAction = forwardRef<React.ElementRef<typeof Pressable>, AccessibleActionProps>(function AccessibleAction({
  accessibilityHint,
  busy = false,
  disabled = false,
  label,
  onPress,
  style,
  textStyle,
  visualLabel = label,
}: AccessibleActionProps, ref) {
  const unavailable = disabled || busy
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      ref={ref}
      style={[styles.action, style]}
    >
      <Text style={[styles.label, textStyle]}>{visualLabel}</Text>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    minWidth: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
})
