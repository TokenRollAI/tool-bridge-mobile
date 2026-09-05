import { useEffect, useRef } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { focusAccessibilityElement } from '@/ui/accessibility'
import { Icon } from '@/ui/components/Icon'
import { spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { PropsWithChildren, RefObject } from 'react'

type ActionSheetProps = PropsWithChildren<Readonly<{
  dismissible?: boolean
  onClose(): void
  returnFocusRef?: RefObject<React.ElementRef<typeof Pressable> | null>
  title: string
  visible: boolean
}>>

// 仅承载用户主动打开的本地操作；远程裁决仍使用专用 PendingConfirmationModal。
export function ActionSheet({ children, dismissible = true, onClose, returnFocusRef, title, visible }: ActionSheetProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const headingRef = useRef<Text>(null)
  const wasVisible = useRef(false)

  useEffect(() => {
    if (visible) void focusAccessibilityElement(headingRef.current)
    else if (wasVisible.current && returnFocusRef?.current) {
      void focusAccessibilityElement(returnFocusRef.current)
    }
    wasVisible.current = visible
  }, [returnFocusRef, title, visible])

  return (
    <Modal animationType="slide" onRequestClose={() => { if (dismissible) onClose() }} statusBarTranslucent transparent visible={visible}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          disabled={!dismissible}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" ref={headingRef} style={styles.title}>{title}</Text>
            <Pressable
              accessibilityLabel={`关闭${title}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !dismissible }}
              disabled={!dismissible}
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
            >
              <Icon color={colors.text} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(7, 12, 20, 0.48)', flex: 1, justifyContent: 'flex-end' },
  close: { alignItems: 'center', borderRadius: 24, justifyContent: 'center', minHeight: 48, minWidth: 48 },
  content: { gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  handle: { alignSelf: 'center', backgroundColor: colors.outline, borderRadius: 2, height: 4, marginTop: spacing.md, width: 32 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingLeft: spacing.xl, paddingRight: spacing.sm, paddingVertical: spacing.md },
  pressed: { backgroundColor: colors.panelElevated },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%', maxWidth: 620, width: '100%' },
  title: { color: colors.text, flex: 1, fontSize: 22, fontWeight: '700' },
})
