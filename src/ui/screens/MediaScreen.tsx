import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction, type ActionVariant } from '@/ui/components/AccessibleAction'
import { EmptyState } from '@/ui/components/EmptyState'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { MediaSessionSnapshot } from '@/capabilities/media/controller'
import type { IconName } from '@/ui/components/Icon'

type MediaScreenProps = Readonly<{
  focused?: boolean
  onBack?: (() => void) | undefined
  onPause(sessionId: string): void
  onResume(sessionId: string): void
  onStop(sessionId: string): void
  session: MediaSessionSnapshot | null
}>

export function MediaScreen({
  focused = true,
  onBack,
  onPause,
  onResume,
  onStop,
  session,
}: MediaScreenProps) {
  const styles = useThemedStyles(createStyles)
  useDiscreteAccessibilityAnnouncement(
    `media:${session?.sessionId ?? 'none'}:${session?.state ?? 'none'}`,
    session === null ? '当前没有媒体会话' : `媒体状态已变为 ${session.state}`,
  )

  return (
    <Screen
      backLabel="设备"
      description="管理这台设备上的 Tool Bridge 播放会话。"
      focused={focused}
      onBack={onBack}
      title="媒体"
    >
      {session === null ? (
        <EmptyState icon="media" title="暂无 App 自有媒体会话。" description="Agent 发起播放后，你可以在这里暂停、继续或停止。" />
      ) : (
        <StatusCard icon="media" title={session.title}>
          <StatusRow label="状态" value={session.state} />
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${session.durationSeconds !== null && session.durationSeconds > 0 ? Math.max(0, Math.min(100, session.currentTimeSeconds / session.durationSeconds * 100)) : 0}%` }]} />
          </View>
          <StatusRow
            label="进度"
            value={`${Math.floor(session.currentTimeSeconds)} / ${session.durationSeconds === null
              ? '未知'
              : Math.floor(session.durationSeconds)} 秒`}
          />
          <View style={styles.actions}>
            {session.state === 'playing' || session.state === 'loading' ? (
              <Action
                icon="pause"
                label="暂停当前媒体会话"
                onPress={() => onPause(session.sessionId)}
                visualLabel="暂停"
              />
            ) : session.state === 'paused' || session.state === 'interrupted' ? (
              <Action
                icon="resume"
                label="继续当前媒体会话"
                onPress={() => onResume(session.sessionId)}
                visualLabel="继续"
              />
            ) : null}
            {session.state === 'stopped' || session.state === 'failed' ? null : (
              <Action
                icon="stop"
                label="停止当前媒体会话"
                onPress={() => onStop(session.sessionId)}
                variant="secondary"
                visualLabel="停止"
              />
            )}
          </View>
          <StatusRow label="调用方" value={session.callerSubjectId} />
          <StatusRow label="来源" value={session.sourceHost} />
          <Text style={styles.privacyNote}>仅播放设备允许的来源；完整 URL 不在此显示。</Text>
        </StatusCard>
      )}
    </Screen>
  )
}

function Action({
  icon,
  label,
  onPress,
  variant = 'primary',
  visualLabel,
}: Readonly<{
  icon: IconName
  label: string
  onPress(): void
  variant?: ActionVariant
  visualLabel: string
}>) {
  const styles = useThemedStyles(createStyles)
  return (
    <AccessibleAction
      accessibilityHint="控制当前由 Tool Bridge App 自有播放器管理的会话"
      icon={icon}
      label={label}
      onPress={onPress}
      style={styles.action}
      variant={variant}
      visualLabel={visualLabel}
    />
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.panelElevated, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  privacyNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  action: {
    flexBasis: 120,
    flexGrow: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
})
