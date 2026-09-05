import { forwardRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icon, type IconName } from '@/ui/components/Icon'
import { useTheme, useThemedStyles, type ThemeColors, radius, spacing } from '@/ui/theme'

import type { AccessibilityRole, StyleProp, TextStyle, ViewStyle } from 'react-native'

export const MINIMUM_ACCESSIBLE_TARGET_SIZE = 48

export type ActionVariant = 'primary' | 'secondary' | 'danger'

type AccessibleActionProps = Readonly<{
  accessibilityHint?: string
  busy?: boolean
  disabled?: boolean
  icon?: IconName
  label: string
  onPress(): void
  role?: AccessibilityRole
  selected?: boolean
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  variant?: ActionVariant
  visualLabel?: string
}>

// 统一 button role、上下文唯一 label、hint、busy/disabled state 与至少 48dp 目标尺寸。
// variant 只影响视觉；无障碍语义完全由 label/hint/state 决定。
export const AccessibleAction = forwardRef<React.ElementRef<typeof Pressable>, AccessibleActionProps>(function AccessibleAction({
  accessibilityHint,
  busy = false,
  disabled = false,
  icon,
  label,
  onPress,
  role = 'button',
  selected,
  style,
  textStyle,
  variant = 'primary',
  visualLabel = label,
}: AccessibleActionProps, ref) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const variantStyles = useThemedStyles(createVariantStyles)
  const textColors: Readonly<Record<ActionVariant, string>> = {
    danger: colors.onDanger, primary: colors.onPrimary, secondary: colors.text,
  }
  const unavailable = disabled || busy
  const resolvedTextColor = StyleSheet.flatten(textStyle)?.color ?? textColors[variant]
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole={role}
      accessibilityState={{
        busy,
        disabled: unavailable,
        ...(selected === undefined ? {} : { selected }),
      }}
      disabled={unavailable}
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles.action,
        variantStyles[variant],
        unavailable ? styles.unavailable : null,
        selected === true ? styles.selected : null,
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  selected: {
    borderColor: colors.primary,
    borderWidth: 1,
  },
  unavailable: {
    opacity: 0.5,
  },
})

const createVariantStyles = (colors: ThemeColors) => StyleSheet.create({
  danger: {
    backgroundColor: colors.danger,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.panel,
    borderColor: colors.outline,
    borderWidth: 1,
  },
})
