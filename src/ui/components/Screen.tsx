import { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement } from '@/ui/accessibility'
import { colors, spacing } from '@/ui/theme'

import type { PropsWithChildren } from 'react'

type ScreenProps = PropsWithChildren<Readonly<{
  description?: string
  eyebrow?: string
  focused?: boolean
  title: string
}>>

export function Screen({
  children,
  description,
  eyebrow,
  focused = true,
  title,
}: ScreenProps) {
  const headingRef = useRef<Text>(null)

  useEffect(() => {
    if (focused) void focusAccessibilityElement(headingRef.current)
  }, [focused])

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  eyebrowBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.panelElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  headerBlock: {
    gap: spacing.sm,
  },
  heading: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
})
