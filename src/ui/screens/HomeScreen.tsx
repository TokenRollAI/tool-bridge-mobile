import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Pill, type PillTone } from '@/ui/components/Pill'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { ControlMode } from '@/commands/types'
import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

const CONTROL_MODE_LABEL: Readonly<Record<ControlMode, string>> = {
  ask_every_time: '每次确认',
  direct_call: '直接调用',
  disabled: '已停用',
  trusted_session: '信任会话',
}

function transportTone(state: ApplicationSnapshot['transportState']): PillTone {
  if (state === 'ready') return 'positive'
  if (state === 'error' || state === 'closed') return 'danger'
  if (state === 'unconfigured' || state === 'credentials_required') return 'caution'
  return 'neutral'
}

function controlModeTone(mode: ControlMode): PillTone {
  if (mode === 'disabled') return 'danger'
  if (mode === 'direct_call') return 'caution'
  return 'positive'
}

type HomeScreenProps = Readonly<{
  focused?: boolean
  onCancelTimer(timerId: string): void
  onOpenSettings(): void
  onStopAttention(): void
  snapshot: ApplicationSnapshot
}>

export function HomeScreen({
  focused = true,
  onCancelTimer,
  onOpenSettings,
  onStopAttention,
  snapshot,
}: HomeScreenProps) {
  useDiscreteAccessibilityAnnouncement(
    `control-mode:${snapshot.controlMode}`,
    `控制模式已变为 ${snapshot.controlMode}`,
  )
  useDiscreteAccessibilityAnnouncement(
    `transport:${snapshot.transportState}`,
    `设备连接状态已变为 ${snapshot.transportState}`,
  )
  useDiscreteAccessibilityAnnouncement(
    snapshot.error === null ? null : `error:${snapshot.error}`,
    snapshot.error,
    'assertive',
  )
  useDiscreteAccessibilityAnnouncement(
    `attention:${snapshot.attentionSession?.sessionId ?? 'none'}`,
    snapshot.attentionSession === null ? '设备提示已停止' : '设备提示已开始',
  )
  const timerStateKey = snapshot.timers
    .map(timer => `${timer.timerId}:${timer.state}`).sort().join(',')
  useDiscreteAccessibilityAnnouncement(
    `timers:${timerStateKey}`,
    '计时器状态已更新',
  )

  return (
    <Screen
      description="设备本地裁决优先于任何远程命令。配置项在“设置”标签页。"
      eyebrow="TOOL BRIDGE MOBILE"
      focused={focused}
      title="设备裁决优先"
    >
      {snapshot.error === null ? null : <Text style={styles.error}>{snapshot.error}</Text>}

      <StatusCard icon="home" title="总览">
        <View style={styles.pills}>
          <Pill
            label="控制模式"
            tone={controlModeTone(snapshot.controlMode)}
            value={CONTROL_MODE_LABEL[snapshot.controlMode]}
          />
          <Pill
            label="连接"
            tone={transportTone(snapshot.transportState)}
            value={snapshot.reachability}
          />
          <Pill
            label="后台运行"
            tone={snapshot.backgroundRuntimeEnabled ? 'positive' : 'neutral'}
            value={snapshot.backgroundRuntimeEnabled ? '已开启' : '已关闭'}
          />
          <Pill label="前后台" tone="neutral" value={snapshot.appState} />
        </View>
      </StatusCard>

      {snapshot.deviceId === null && snapshot.mountPath === null ? null : (
        <StatusCard icon="connection" title="连接详情">
          {snapshot.deviceId === null ? null : (
            <StatusRow label="SDK deviceId" value={snapshot.deviceId} />
          )}
          {snapshot.mountPath === null ? null : (
            <StatusRow label="挂载路径" value={snapshot.mountPath} />
          )}
          {snapshot.transportIssue === null ? null : (
            <StatusRow label="连接问题" value={snapshot.transportIssue} />
          )}
        </StatusCard>
      )}

      {snapshot.attentionSession === null ? null : (
        <StatusCard icon="notification" title="正在提示设备">
          <StatusRow label="调用方" value={snapshot.attentionSession.callerSubjectId} />
          <StatusRow
            label="剩余时间"
            value={`${snapshot.attentionSession.remainingSeconds} 秒`}
          />
          <AccessibleAction
            accessibilityHint="立即停止当前由 Tool Bridge 发起的设备提示"
            icon="stop"
            label="停止设备提示"
            onPress={onStopAttention}
          />
        </StatusCard>
      )}

      {snapshot.timers.map(timer => (
        <StatusCard icon="timer" key={timer.timerId} title="App 内计时器">
          <StatusRow label="调用方" value={timer.ownerSubjectId} />
          <StatusRow label="目标时间" value={timer.firesAt} />
          <StatusRow label="持久状态" value={timer.state} />
          <Text style={styles.footnote}>
            目标时间不等于系统已准时展示；呈现结果由系统决定。
          </Text>
          <AccessibleAction
            accessibilityHint="取消并清理这个本机计时器；到点竞态下不声称通知从未展示"
            label={`取消 ${timer.ownerSubjectId} 在 ${timer.firesAt} 的计时器`}
            onPress={() => { onCancelTimer(timer.timerId) }}
            variant="secondary"
            visualLabel="取消此计时器"
          />
        </StatusCard>
      ))}

      <AccessibleAction
        accessibilityHint="打开设置页调整控制模式、后台运行、网关连接与通知"
        icon="settings"
        label="打开设置"
        onPress={onOpenSettings}
        variant="secondary"
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  error: {
    backgroundColor: colors.panel,
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  footnote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
})
