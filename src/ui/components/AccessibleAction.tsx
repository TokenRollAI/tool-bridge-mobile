import { forwardRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icon, type IconName } from '@/ui/components/Icon'
import { colors, radius, spacing } from '@/ui/theme'

import type { StyleProp, TextStyle, ViewStyle } from 'react-native'

export const MINIMUM_ACCESSIBLE_TARGET_SIZE = 48

export type ActionVariant = 'primary' | 'secondary' | 'danger'

type AccessibleActionProps = Readonly<{
  accessibilityHint?: string
  busy?: boolean
  disabled?: boolean
  icon?: IconName
  label: string
  onPress(): void
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  variant?: ActionVariant
  visualLabel?: string
}>

const VARIANT_TEXT_COLOR: Readonly<Record<ActionVariant, string>> = {
  danger: colors.text,
  primary: colors.background,
  secondary: colors.text,
}

// 统一 button role、上下文唯一 label、hint、busy/disabled state 与至少 48dp 目标尺寸。
// variant 只影响视觉；无障碍语义完全由 label/hint/state 决定。
export const AccessibleAction = forwardRef<React.ElementRef<typeof Pressable>, AccessibleActionProps>(function AccessibleAction({
  accessibilityHint,
  busy = false,
  disabled = false,
  icon,
  label,
  onPress,
  style,
  textStyle,
  variant = 'primary',
  visualLabel = label,
}: AccessibleActionProps, ref) {
  const unavailable = disabled || busy
  const resolvedTextColor = StyleSheet.flatten(textStyle)?.color ?? VARIANT_TEXT_COLOR[variant]
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles.action,
        variantStyles[variant],
        unavailable ? styles.unavailable : null,
        pressed && !unavailable ? styles.pressed : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {icon === undefined ? null : (
          <Icon color={String(resolvedTextColor)} name={icon} size={18} />
        )}
        <Text style={[styles.label, { color: resolvedTextColor }, textStyle]}>{visualLabel}</Text>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    minWidth: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  content: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  unavailable: {
    opacity: 0.5,
  },
})

const variantStyles = StyleSheet.create({
  danger: {
    backgroundColor: colors.danger,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.panelElevated,
    borderColor: colors.outline,
    borderWidth: 1,
  },
})
