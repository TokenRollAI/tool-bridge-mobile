import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors } from '@/ui/theme'

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
        <Text style={styles.empty}>暂无 App 自有媒体会话。</Text>
      ) : (
        <StatusCard title={session.title}>
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
                label="暂停当前媒体会话"
                onPress={() => onPause(session.sessionId)}
                visualLabel="暂停"
              />
            ) : session.state === 'paused' || session.state === 'interrupted' ? (
              <Action
                label="继续当前媒体会话"
                onPress={() => onResume(session.sessionId)}
                visualLabel="继续"
              />
            ) : null}
            {session.state === 'stopped' || session.state === 'failed' ? null : (
              <Action
                label="停止当前媒体会话"
                onPress={() => onStop(session.sessionId)}
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
  label,
  onPress,
  visualLabel,
}: Readonly<{ label: string; onPress(): void; visualLabel: string }>) {
  return (
    <AccessibleAction
      accessibilityHint="控制当前由 Tool Bridge App 自有播放器管理的会话"
      label={label}
      onPress={onPress}
      style={styles.action}
      visualLabel={visualLabel}
    />
  )
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  empty: {
    color: colors.muted,
  },
})
