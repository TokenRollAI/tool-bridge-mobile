import { StyleSheet, Text } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { GatewayConfigurationCard } from '@/ui/components/GatewayConfigurationCard'
import { Screen } from '@/ui/components/Screen'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors } from '@/ui/theme'

import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'
import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

function transportDescription(snapshot: ApplicationSnapshot): string {
  switch (snapshot.transportState) {
    case 'ready':
      return 'Tool Bridge SDK 前台连接已就绪；所有调用仍由设备本地策略、权限与确认裁决。'
    case 'connecting':
    case 'reconnecting':
      return 'Tool Bridge SDK 正在建立前台设备连接；尚未收到 ready 前不会声称在线。'
    case 'credentials_required':
      return '网关地址已配置，但系统安全存储中没有可用的 API key。'
    case 'suspended':
      return 'Tool Bridge SDK 连接已暂停；App 回到前台且本地控制模式允许时才恢复。'
    case 'closed':
    case 'error':
      return 'Tool Bridge SDK 连接当前不可用；本地能力不会因此绕过安全裁决。'
    case 'unconfigured':
      return 'Tool Bridge SDK transport 已接入；请在本机填写 Gateway HTTPS URL 与 API key。'
  }
}

type HomeScreenProps = Readonly<{
  focused?: boolean
  /** @deprecated 确认操作已提升到根布局的全局 Modal。 */
  onApproveConfirmation?(commandId: string): void
  onCancelTimer(timerId: string): void
  onClearGatewayConfiguration(): Promise<void>
  onEnable(): void
  onEmergencyDisable(): void
  onOpenNotificationSettings(): void
  /** @deprecated 确认操作已提升到根布局的全局 Modal。 */
  onRejectConfirmation?(commandId: string): void
  onRequestNotificationPermission(): void
  onSaveGatewayConfiguration(input: ManualGatewayConfigurationInput): Promise<void>
  onStopAttention(): void
  snapshot: ApplicationSnapshot
}>

export function HomeScreen({
  focused = true,
  onCancelTimer,
  onClearGatewayConfiguration,
  onEnable,
  onEmergencyDisable,
  onOpenNotificationSettings,
  onRequestNotificationPermission,
  onSaveGatewayConfiguration,
  onStopAttention,
  snapshot,
}: HomeScreenProps) {
  const isDisabled = snapshot.controlMode === 'disabled'
  const notificationAvailability = snapshot.capabilities.find(({ descriptor }) => (
    descriptor.path === 'phone/productivity' && descriptor.tool === 'notify'
  ))?.availability
  const notificationSettingsRequired = notificationAvailability?.status === 'unavailable'
    && (
      notificationAvailability.reason === 'notification_permission_denied'
      || notificationAvailability.reason === 'notification_channel_disabled'
    )
  const notificationPermissionRequestable = notificationAvailability?.status === 'unavailable'
    && notificationAvailability.reason === 'notification_permission_requestable'

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
  const timerStateKey = snapshot.timers
    .map(timer => `${timer.timerId}:${timer.state}`).sort().join(',')
  useDiscreteAccessibilityAnnouncement(
    `timers:${timerStateKey}`,
    '计时器状态已更新',
  )
  useDiscreteAccessibilityAnnouncement(
    `attention:${snapshot.attentionSession?.sessionId ?? 'none'}`,
    snapshot.attentionSession === null ? '设备提示已停止' : '设备提示已开始',
  )

  return (
    <Screen
      description={transportDescription(snapshot)}
      eyebrow="TOOL BRIDGE MOBILE"
      focused={focused}
      title="设备裁决优先"
    >
      {snapshot.error === null ? null : <Text style={styles.error}>{snapshot.error}</Text>}

      <StatusCard title="本机状态">
        <StatusRow label="运行时" value={snapshot.phase} />
        <StatusRow label="可达性" value={snapshot.reachability} />
        <StatusRow label="SDK transport" value={snapshot.transportState} />
        <StatusRow label="控制模式" value={snapshot.controlMode} />
        <StatusRow
          label="installationId"
          value={snapshot.installationId ?? '正在从安全存储加载'}
        />
        {snapshot.deviceId === null ? null : (
          <StatusRow label="SDK deviceId" value={snapshot.deviceId} />
        )}
        {snapshot.mountPath === null ? null : (
          <StatusRow label="挂载路径" value={snapshot.mountPath} />
        )}
        {snapshot.transportIssue === null ? null : (
          <StatusRow label="连接问题" value={snapshot.transportIssue} />
        )}
        {snapshot.transportDiagnostic === null ? null : (
          <>
            <StatusRow label="失败类型" value={snapshot.transportDiagnostic.kind} />
            <StatusRow label="失败阶段" value={snapshot.transportDiagnostic.stage} />
            <StatusRow
              label="WS 关闭码"
              value={snapshot.transportDiagnostic.closeCode?.toString() ?? 'unavailable'}
            />
          </>
        )}
      </StatusCard>

      <GatewayConfigurationCard
        currentOrigin={snapshot.gatewayOrigin}
        onClear={onClearGatewayConfiguration}
        onSave={onSaveGatewayConfiguration}
      />

      {snapshot.attentionSession === null ? null : (
        <StatusCard title="正在提示设备">
          <StatusRow label="调用方" value={snapshot.attentionSession.callerSubjectId} />
          <StatusRow
            label="剩余时间"
            value={`${snapshot.attentionSession.remainingSeconds} 秒`}
          />
          <AccessibleAction
            accessibilityHint="立即停止当前由 Tool Bridge 发起的设备提示"
            label="停止设备提示"
            onPress={onStopAttention}
            style={[styles.action, styles.stopAction]}
          />
        </StatusCard>
      )}

      {notificationPermissionRequestable ? (
        <StatusCard title="本地通知未启用">
          <Text style={styles.body}>
            Tool Bridge 只在你主动允许后创建可见的即时通知；远程命令不会弹出系统权限框。
          </Text>
          <Text style={styles.footnote}>系统仍允许你从此处主动请求通知权限。</Text>
          <AccessibleAction
            accessibilityHint="打开系统通知权限请求；远程命令不能代替你执行此操作"
            label="启用本地通知"
            onPress={onRequestNotificationPermission}
            style={[styles.action, styles.enableAction]}
          />
        </StatusCard>
      ) : null}

      {notificationSettingsRequired ? (
        <StatusCard title="本地通知已关闭">
          <Text style={styles.body}>
            系统通知权限或 Tool Bridge 本地通知 channel 已关闭；远程命令无权改变该设置。
          </Text>
          <AccessibleAction
            accessibilityHint="前往系统设置调整 Tool Bridge 的通知权限或 channel"
            label="打开系统设置"
            onPress={onOpenNotificationSettings}
            style={[styles.action, styles.enableAction]}
          />
        </StatusCard>
      ) : null}

      {snapshot.timers.map(timer => (
        <StatusCard key={timer.timerId} title="App 内计时器">
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
            style={[styles.action, styles.stopAction]}
            visualLabel="取消此计时器"
          />
        </StatusCard>
      ))}

      <AccessibleAction
        accessibilityHint={isDisabled
          ? '恢复为每条有副作用命令都在设备上确认'
          : '立即拒绝新命令并停止仍可撤销的本地副作用'}
        label={isDisabled ? '恢复为每次确认' : '紧急停用远程能力'}
        onPress={isDisabled ? onEnable : onEmergencyDisable}
        style={[styles.action, isDisabled ? styles.enableAction : styles.disableAction]}
      />
      <Text style={styles.footnote}>
        紧急停用会在本地策略层拒绝所有新命令；系统权限与用户拒绝始终优先。
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  action: {
    borderRadius: 14,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  disableAction: {
    backgroundColor: colors.danger,
  },
  enableAction: {
    backgroundColor: colors.primary,
  },
  error: {
    color: colors.danger,
  },
  footnote: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  stopAction: {
    backgroundColor: colors.primary,
  },
})
