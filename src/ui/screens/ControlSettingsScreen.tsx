import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { SectionHeading } from '@/ui/components/SectionHeading'
import { SettingToggle } from '@/ui/components/SettingToggle'
import { StatusCard } from '@/ui/components/StatusCard'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { ControlMode } from '@/commands/types'
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
    hint: '跳过逐次确认；系统权限、平台限制与紧急停用仍然有效',
    label: '允许直接调用（含高危）',
    mode: 'direct_call',
  },
]

type ControlSettingsScreenProps = Readonly<{
  focused?: boolean
  onBack(): void
  onEmergencyDisable(): void
  onEnable(): void
  onOpenCameraSettings(): void
  onOpenNotificationSettings(): void
  onRequestNotificationPermission(): void
  onRequestCameraPermission(): void
  onSetBackgroundRuntime(enabled: boolean): void
  onSetControlMode(mode: ControlMode): void
  snapshot: ApplicationSnapshot
}>

export function ControlSettingsScreen({
  focused = true,
  onBack,
  onEmergencyDisable,
  onEnable,
  onOpenCameraSettings,
  onOpenNotificationSettings,
  onRequestNotificationPermission,
  onRequestCameraPermission,
  onSetBackgroundRuntime,
  onSetControlMode,
  snapshot,
}: ControlSettingsScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
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
  const cameraAvailability = snapshot.capabilities.find(({ descriptor }) => (
    descriptor.path === 'phone/camera' && descriptor.tool === 'capture_photo'
  ))?.availability
  const cameraPermissionRequestable = cameraAvailability?.status === 'permission_required'
    && cameraAvailability.reason === 'camera_permission_required'
  const cameraSettingsRequired = cameraAvailability?.status === 'unavailable'
    && cameraAvailability.reason === 'camera_permission_denied'

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
      backLabel="设备"
      description="每条命令如何执行，始终由本机授权决定。"
      focused={focused}
      onBack={onBack}
      title="授权与安全"
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
          <SectionHeading title="控制模式" detail="系统权限与用户拒绝始终优先" />
          <View style={styles.modeList}>
            <Text style={styles.body}>
              选择 Agent 命令在本机的裁决强度。
            </Text>
            {CONTROL_MODE_OPTIONS.map(option => {
              const active = snapshot.controlMode === option.mode
              return (
                <Pressable
                  accessibilityHint={option.hint}
                  accessibilityLabel={active ? `${option.label}（当前）` : option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={option.mode}
                  onPress={() => { onSetControlMode(option.mode) }}
                  style={({ pressed }) => [styles.modeOption, active ? styles.modeOptionActive : null, pressed ? styles.navRowPressed : null]}
                >
                  <View style={styles.modeCopy}>
                    <Text style={[styles.modeTitle, active ? styles.modeTitleActive : null]}>{option.label}</Text>
                    <Text style={styles.modeDescription}>{option.hint}</Text>
                  </View>
                  <Icon color={active ? colors.primary : colors.outline} name={active ? 'positive' : 'neutral'} size={22} />
                </Pressable>
              )
            })}
            {snapshot.controlMode === 'direct_call' ? (
              <View style={styles.warningNote}>
                <Icon color={colors.warning} name="warning" size={16} />
                <Text style={styles.warningText}>
                  直接调用模式下高特权工具（shell、剪贴板、任意 URL/Intent）可被 Agent 直接执行；
                  前台相机也会在可见预览就绪后自动拍摄并上传。请仅在你完全信任当前网关与 Agent 时启用。
                </Text>
              </View>
            ) : null}
          </View>

          <StatusCard icon="background" title="后台运行">
            <SettingToggle
              description="退到后台时保持设备连接。Android 会显示一个常驻通知；iOS 不支持后台常驻，仅依赖前台。系统省电策略仍可能中断连接。"
              label="允许后台运行"
              onToggle={onSetBackgroundRuntime}
              value={snapshot.backgroundRuntimeEnabled}
            />
          </StatusCard>

          <SectionHeading title="系统权限" detail="仅在你主动操作时请求" />
          <Text style={styles.body}>下面只显示当前可由本机请求或调整的权限。完整可用性以设备能力页的实际探测为准。</Text>

          {cameraPermissionRequestable ? (
            <StatusCard icon="camera" title="前台相机未启用">
              <Text style={styles.body}>
                相机只用于前台可见预览和单张拍摄；不会申请麦克风、图库或后台相机权限。
              </Text>
              <AccessibleAction
                accessibilityHint="打开系统相机权限请求；系统拒绝始终优先"
                icon="camera"
                label="启用前台相机"
                onPress={onRequestCameraPermission}
              />
            </StatusCard>
          ) : null}

          {cameraSettingsRequired ? (
            <StatusCard icon="camera" title="前台相机已关闭">
              <Text style={styles.body}>
                系统相机权限已被永久拒绝；远程命令和直接调用模式都不能绕过该设置。
              </Text>
              <AccessibleAction
                accessibilityHint="前往系统设置调整 Tool Bridge 的相机权限"
                icon="settings"
                label="打开相机设置"
                onPress={onOpenCameraSettings}
              />
            </StatusCard>
          ) : null}

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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  modeList: { gap: spacing.md },
  modeOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 80, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.md, padding: spacing.lg },
  modeOptionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modeCopy: { flex: 1, gap: spacing.xs },
  modeTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modeTitleActive: { color: colors.primary },
  modeDescription: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  navRowPressed: {
    opacity: 0.7,
  },
  warningNote: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSoft,
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
