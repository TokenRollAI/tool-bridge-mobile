import { useEffect, useRef } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement } from '@/ui/accessibility'
import { MINIMUM_ACCESSIBLE_TARGET_SIZE } from '@/ui/components/AccessibleAction'
import { Icon } from '@/ui/components/Icon'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { PropsWithChildren, ReactNode } from 'react'

type ScreenProps = PropsWithChildren<Readonly<{
  backLabel?: string
  description?: string
  eyebrow?: string
  focused?: boolean
  headerAccessory?: ReactNode
  onBack?: (() => void) | undefined
  title: string
  titlePlacement?: 'header' | 'content'
  titleSize?: 'large' | 'compact'
  tone?: 'default' | 'reading'
  toolbar?: ReactNode
}>>

export function Screen({
  backLabel = '返回',
  children,
  description,
  eyebrow,
  focused = true,
  headerAccessory,
  onBack,
  title,
  titlePlacement = 'header',
  titleSize = 'large',
  tone = 'default',
  toolbar,
}: ScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const headingRef = useRef<Text>(null)

  useEffect(() => {
    if (focused) void focusAccessibilityElement(headingRef.current)
  }, [focused])

  const heading = (
    <View style={styles.headingBlock}>
      {eyebrow === undefined ? null : (
        <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.eyebrow}>{eyebrow}</Text>
      )}
      <Text
        accessibilityRole="header"
        ref={headingRef}
        style={[styles.heading, titleSize === 'compact' ? styles.compactHeading : null]}
      >{title}</Text>
      {description === undefined ? null : <Text style={styles.description}>{description}</Text>}
    </View>
  )

  return (
    <SafeAreaView
      edges={onBack === undefined ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}
      style={[styles.safeArea, tone === 'reading' ? styles.reading : null]}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <View style={styles.chrome}>
          <View style={styles.header}>
            {onBack === undefined ? null : (
              <Pressable
                accessibilityLabel={backLabel}
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
              >
                <Icon color={colors.text} name="back" size={22} />
                {titlePlacement === 'content' ? <Text style={styles.backLabel}>{backLabel}</Text> : null}
              </Pressable>
            )}
            {titlePlacement === 'header' ? heading : <View style={styles.fill} />}
            {headerAccessory === undefined ? null : <View style={styles.accessory}>{headerAccessory}</View>}
          </View>
          {toolbar === undefined ? null : <View style={styles.toolbar}>{toolbar}</View>}
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.fill}
        >
          {titlePlacement === 'content' ? heading : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  accessory: { alignItems: 'flex-end', justifyContent: 'center' },
  backButton: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginLeft: -spacing.sm,
    minHeight: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    minWidth: MINIMUM_ACCESSIBLE_TARGET_SIZE,
    paddingHorizontal: spacing.sm,
  },
  backLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  chrome: { backgroundColor: colors.panel, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  compactHeading: { fontSize: 21, letterSpacing: 0 },
  content: {
    alignSelf: 'center',
    gap: spacing.xl,
    maxWidth: 720,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    width: '100%',
  },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  fill: { flex: 1 },
  header: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: 720,
    minHeight: 72,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    width: '100%',
  },
  heading: { color: colors.text, fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  headingBlock: { flexShrink: 1, flexGrow: 1, gap: spacing.sm },
  pressed: { opacity: 0.6 },
  reading: { backgroundColor: colors.panel },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  toolbar: { alignSelf: 'center', maxWidth: 720, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, width: '100%' },
})
