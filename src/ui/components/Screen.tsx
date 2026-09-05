import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement } from '@/ui/accessibility'
import { MINIMUM_ACCESSIBLE_TARGET_SIZE } from '@/ui/components/AccessibleAction'
import { Icon } from '@/ui/components/Icon'
import { useTheme, useThemedStyles, type ThemeColors, radius, spacing } from '@/ui/theme'

import type { PropsWithChildren } from 'react'

type ScreenProps = PropsWithChildren<Readonly<{
  backLabel?: string
  description?: string
  eyebrow?: string
  focused?: boolean
  onBack?: (() => void) | undefined
  title: string
}>>

export function Screen({
  backLabel = '返回',
  children,
  description,
  eyebrow,
  focused = true,
  onBack,
  title,
}: ScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const headingRef = useRef<Text>(null)

  useEffect(() => {
    if (focused) void focusAccessibilityElement(headingRef.current)
  }, [focused])

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {onBack === undefined ? null : (
          <Pressable
            accessibilityLabel={backLabel}
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
          >
            <Icon color={colors.primary} name="back" size={20} />
            <Text style={styles.backLabel}>{backLabel}</Text>
          </Pressable>
        )}
        <View style={styles.headerBlock}>
          {eyebrow === undefined ? null : (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.eyebrowBadge}
            >
              <Text style={styles.eyebrow}>{eyebrow}</Text>
            </View>
          )}
          <Text accessibilityRole="header" ref={headingRef} style={styles.heading}>{title}</Text>
          {description === undefined ? null : (
            <Text style={styles.description}>{description}</Text>
          )}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    columnGap: spacing.xs,
    flexDirection: 'row',
    marginLeft: -spacing.sm,
    minHeight: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    paddingHorizontal: spacing.sm,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 720,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  eyebrowBadge: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  headerBlock: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  heading: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
})
