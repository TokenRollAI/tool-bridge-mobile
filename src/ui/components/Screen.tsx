import { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement } from '@/ui/accessibility'
import { colors } from '@/ui/theme'

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
      <ScrollView contentContainerStyle={styles.content}>
        {eyebrow === undefined ? null : (
          <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.eyebrow}>
            {eyebrow}
          </Text>
        )}
        <Text accessibilityRole="header" ref={headingRef} style={styles.heading}>{title}</Text>
        {description === undefined ? null : (
          <Text style={styles.description}>{description}</Text>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  heading: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
})
