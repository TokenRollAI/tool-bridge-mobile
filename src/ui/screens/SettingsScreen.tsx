import { StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { GatewayConfigurationCard } from '@/ui/components/GatewayConfigurationCard'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { SettingToggle } from '@/ui/components/SettingToggle'
import { StatusCard } from '@/ui/components/StatusCard'
import { colors, radius, spacing } from '@/ui/theme'

import type { ControlMode } from '@/commands/types'
import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'
import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

const CONTROL_MODE_OPTIONS: readonly Readonly<{
  hint: string
  label: string
  mode: Exclude<ControlMode, 'disabled'>
}>[] = [
  {
    hint: '每条有副作用的命令都在设备上逐次确认',
    label: '每次确认',
    mode: 'ask_every_time',
  },
  {
    hint: '低/中风险命令直接执行，高风险仍逐次确认',
    label: '信任会话（非高危直调）',
    mode: 'trusted_session',
  },
  {
    hint: '所有命令（含高风险）直接执行，不再询问；仅紧急停用可中断',
    label: '允许直接调用（含高危）',
    mode: 'direct_call',
  },
]

type SettingsScreenProps = Readonly<{
  focused?: boolean
  onClearGatewayConfiguration(): Promise<void>
  onEmergencyDisable(): void
  onEnable(): void
  onOpenNotificationSettings(): void
  onRequestNotificationPermission(): void
  onSaveGatewayConfiguration(input: ManualGatewayConfigurationInput): Promise<void>
  onSetBackgroundRuntime(enabled: boolean): void
  onSetControlMode(mode: ControlMode): void
  snapshot: ApplicationSnapshot
}>

export function SettingsScreen({
  focused = true,
  onClearGatewayConfiguration,
  onEmergencyDisable,
  onEnable,
  onOpenNotificationSettings,
  onRequestNotificationPermission,
  onSaveGatewayConfiguration,
  onSetBackgroundRuntime,
  onSetControlMode,
  snapshot,
}: SettingsScreenProps) {
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
    `background:${snapshot.backgroundRuntimeEnabled}`,
    snapshot.backgroundRuntimeEnabled ? '后台运行已开启' : '后台运行已关闭',
  )

  return (
    <Screen
      description="集中管理裁决强度、后台运行、网关连接与本地通知。系统权限与用户拒绝始终优先。"
      eyebrow="设置"
      focused={focused}
      title="设置"
    >
      {isDisabled ? (
        <StatusCard icon="disabled" title="远程能力已停用" tone="danger">
          <Text style={styles.body}>
            当前处于紧急停用状态：所有新命令在本地策略层被拒绝。恢复后才能调整其他设置。
          </Text>
          <AccessibleAction
            accessibilityHint="恢复为每条有副作用命令都在设备上确认"
            icon="positive"
            label="恢复为每次确认"
            onPress={onEnable}
          />
        </StatusCard>
      ) : (
        <>
          <StatusCard icon="settings" title="控制模式">
            <Text style={styles.body}>
              选择 Agent 命令在本机的裁决强度。
            </Text>
            {CONTROL_MODE_OPTIONS.map(option => {
              const active = snapshot.controlMode === option.mode
              return (
                <AccessibleAction
                  accessibilityHint={option.hint}
                  key={option.mode}
                  label={active ? `${option.label}（当前）` : option.label}
                  onPress={() => { onSetControlMode(option.mode) }}
                  variant={active ? 'primary' : 'secondary'}
                  {...(active ? { icon: 'positive' as const } : {})}
                />
              )
            })}
            {snapshot.controlMode === 'direct_call' ? (
              <View style={styles.warningNote}>
                <Icon color={colors.warning} name="warning" size={16} />
                <Text style={styles.warningText}>
                  直接调用模式下高特权工具（shell、剪贴板、任意 URL/Intent）可被 Agent 直接执行；
                  请仅在你完全信任当前网关与 Agent 时启用。
                </Text>
              </View>
            ) : null}
          </StatusCard>

          <StatusCard icon="background" title="后台运行">
            <SettingToggle
              description="退到后台时保持设备连接。Android 会显示一个常驻通知；iOS 不支持后台常驻，仅依赖前台。系统省电策略仍可能中断连接。"
              label="允许后台运行"
              onToggle={onSetBackgroundRuntime}
              value={snapshot.backgroundRuntimeEnabled}
            />
          </StatusCard>

          <GatewayConfigurationCard
            currentOrigin={snapshot.gatewayOrigin}
            defaultDeviceId={snapshot.defaultDeviceId}
            onClear={onClearGatewayConfiguration}
            onSave={onSaveGatewayConfiguration}
          />

          {notificationPermissionRequestable ? (
            <StatusCard icon="notification" title="本地通知未启用">
              <Text style={styles.body}>
                Tool Bridge 只在你主动允许后创建可见的即时通知；远程命令不会弹出系统权限框。
              </Text>
              <AccessibleAction
                accessibilityHint="打开系统通知权限请求；远程命令不能代替你执行此操作"
                icon="notification"
                label="启用本地通知"
                onPress={onRequestNotificationPermission}
              />
            </StatusCard>
          ) : null}

          {notificationSettingsRequired ? (
            <StatusCard icon="notification" title="本地通知已关闭">
              <Text style={styles.body}>
                系统通知权限或 Tool Bridge 本地通知 channel 已关闭；远程命令无权改变该设置。
              </Text>
              <AccessibleAction
                accessibilityHint="前往系统设置调整 Tool Bridge 的通知权限或 channel"
                icon="settings"
                label="打开系统设置"
                onPress={onOpenNotificationSettings}
              />
            </StatusCard>
          ) : null}

          <StatusCard icon="warning" title="紧急停用" tone="danger">
            <Text style={styles.body}>
              立即拒绝所有新命令并停止仍可撤销的本地副作用。系统权限与用户拒绝始终优先。
            </Text>
            <AccessibleAction
              accessibilityHint="立即拒绝新命令并停止仍可撤销的本地副作用"
              icon="disabled"
              label="紧急停用远程能力"
              onPress={onEmergencyDisable}
              variant="danger"
            />
          </StatusCard>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  warningNote: {
    alignItems: 'flex-start',
    backgroundColor: colors.panelElevated,
    borderRadius: radius.sm,
    columnGap: spacing.sm,
    flexDirection: 'row',
    padding: spacing.md,
  },
  warningText: {
    color: colors.warning,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 19,
  },
})
