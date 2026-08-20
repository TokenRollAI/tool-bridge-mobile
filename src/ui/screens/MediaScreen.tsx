import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction, type ActionVariant } from '@/ui/components/AccessibleAction'
import { Icon, type IconName } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { MediaSessionSnapshot } from '@/capabilities/media/controller'

type MediaScreenProps = Readonly<{
  focused?: boolean
  onPause(sessionId: string): void
  onResume(sessionId: string): void
  onStop(sessionId: string): void
  session: MediaSessionSnapshot | null
}>

export function MediaScreen({
  focused = true,
  onPause,
  onResume,
  onStop,
  session,
}: MediaScreenProps) {
  useDiscreteAccessibilityAnnouncement(
    `media:${session?.sessionId ?? 'none'}:${session?.state ?? 'none'}`,
    session === null ? '当前没有媒体会话' : `媒体状态已变为 ${session.state}`,
  )

  return (
    <Screen
      description="只播放设备配置 allowlist 内的 HTTPS 来源；完整 URL 不进入此页面或普通审计日志。"
      focused={focused}
      title="媒体"
    >
      {session === null ? (
        <View style={styles.emptyCard}>
          <Icon color={colors.muted} name="media" size={28} />
          <Text style={styles.empty}>暂无 App 自有媒体会话。</Text>
        </View>
      ) : (
        <StatusCard icon="media" title={session.title}>
          <StatusRow label="调用方" value={session.callerSubjectId} />
          <StatusRow label="来源" value={session.sourceHost} />
          <StatusRow label="状态" value={session.state} />
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

const styles = StyleSheet.create({
  action: {
    flexBasis: 120,
    flexGrow: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  empty: {
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
})
