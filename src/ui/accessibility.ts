import { useEffect, useRef } from 'react'
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
} from 'react-native'

type AccessibilityElement = Parameters<typeof findNodeHandle>[0]
type AnnouncementPriority = 'assertive' | 'polite'

export async function focusAccessibilityElement(element: AccessibilityElement): Promise<void> {
  if (element === null) return
  try {
    if (!await AccessibilityInfo.isScreenReaderEnabled()) return
    const reactTag = findNodeHandle(element)
    if (reactTag !== null) AccessibilityInfo.setAccessibilityFocus(reactTag)
  } catch {
    // Accessibility service 查询失败不能阻止页面交互。
  }
}

export function announceForAccessibility(
  message: string,
  priority: AnnouncementPriority = 'polite',
): void {
  if (message.length === 0) return
  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      queue: priority === 'polite',
    })
    return
  }
  AccessibilityInfo.announceForAccessibility(message)
}

export function useDiscreteAccessibilityAnnouncement(
  semanticKey: string | null,
  message: string | null,
  priority: AnnouncementPriority = 'polite',
): void {
  const previousKey = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (previousKey.current === undefined) {
      previousKey.current = semanticKey
      return
    }
    if (previousKey.current === semanticKey) return
    previousKey.current = semanticKey
    if (semanticKey !== null && message !== null) {
      announceForAccessibility(message, priority)
    }
  }, [message, priority, semanticKey])
}
