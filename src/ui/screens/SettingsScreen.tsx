import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { Icon, type IconName } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { SectionHeading } from '@/ui/components/SectionHeading'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { ControlMode } from '@/commands/types'
import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

const MODE_LABELS: Record<ControlMode, string> = {
  ask_every_time: '每次确认',
  direct_call: '直接调用',
  disabled: '远程能力已停用',
  trusted_session: '信任会话',
}

type SettingsScreenProps = Readonly<{
  focused?: boolean
  onEmergencyDisable(): void
  onEnable(): void
  onOpenCapabilities(): void
  onOpenConnection(): void
  onOpenControls(): void
  onOpenMedia(): void
  onOpenStatus(): void
  snapshot: ApplicationSnapshot
}>

export function SettingsScreen({
  focused = true,
  onEmergencyDisable,
  onEnable,
  onOpenCapabilities,
  onOpenConnection,
  onOpenControls,
  onOpenMedia,
  onOpenStatus,
  snapshot,
}: SettingsScreenProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const disabled = snapshot.controlMode === 'disabled'
  const connected = snapshot.transportState === 'ready'
  const deviceId = snapshot.deviceId ?? snapshot.defaultDeviceId
  const availableCount = snapshot.capabilities.filter(item => item.availability.status === 'available').length

  useDiscreteAccessibilityAnnouncement(
    `device-control:${snapshot.controlMode}`,
    `控制模式已变为 ${MODE_LABELS[snapshot.controlMode]}`,
  )

  return (
    <Screen focused={focused} title="设备">
      <View style={styles.identity}>
        <View style={styles.deviceMark}><Icon color={colors.primary} name="device" size={44} /></View>
        <Text style={styles.deviceCaption}>当前设备</Text>
        <Text selectable style={styles.deviceId}>{deviceId ?? '设备身份准备中'}</Text>
        <View style={styles.connectionStatus}>
          <Icon color={connected ? colors.success : colors.muted} name={connected ? 'positive' : 'connection'} size={16} />
          <Text style={[styles.connectionLabel, connected ? styles.connectedLabel : null]}>{connected ? '已连接网关' : '网关尚未就绪'}</Text>
        </View>
        <Text style={styles.identityNote}>{deviceId === null ? '初始化完成后显示本机设备 ID。' : '这是 Agent 连接与识别这台设备时使用的 ID。'}</Text>
      </View>

      <SectionHeading title="连接与授权" />
      <View style={styles.group}>
        <NavRow description={snapshot.gatewayOrigin ?? '设置网关地址与 API key'} icon="connection" label="连接配置" onPress={onOpenConnection} />
        <NavRow description={MODE_LABELS[snapshot.controlMode]} icon="shield" label="授权与安全" onPress={onOpenControls} />
      </View>

      {snapshot.controlMode === 'direct_call' ? (
        <View style={styles.warning}>
          <Icon color={colors.warning} name="warning" size={18} />
          <Text style={styles.warningText}>直接调用已开启，包括高风险命令。系统权限与设备限制仍然有效；可随时紧急停用。</Text>
        </View>
      ) : null}

      <SectionHeading title="能力与运行" />
      <View style={styles.group}>
        <NavRow description={`${availableCount} 项可用 · ${snapshot.capabilities.length} 项已探测`} icon="capabilities" label="设备能力" onPress={onOpenCapabilities} />
        <NavRow description="连接状态、设备提示与计时器" icon="home" label="运行详情" onPress={onOpenStatus} />
        <NavRow description={snapshot.mediaSession === null ? '当前没有媒体会话' : snapshot.mediaSession.title} icon="media" label="媒体会话" onPress={onOpenMedia} />
      </View>

      <View style={styles.safetyControl}>
        <AccessibleAction
          accessibilityHint={disabled ? '恢复为每条有副作用命令都在设备上确认' : '立即拒绝新命令并停止仍可撤销的本地副作用'}
          icon={disabled ? 'positive' : 'disabled'}
          label={disabled ? '恢复为每次确认' : '紧急停用远程能力'}
          onPress={disabled ? onEnable : onEmergencyDisable}
          variant={disabled ? 'primary' : 'danger'}
        />
        <Text style={styles.safetyNote}>{disabled ? '新命令当前均被拒绝。恢复后，仍需在本机逐次确认。' : '立即拒绝新命令，并停止仍可撤销的本地操作。'}</Text>
      </View>
    </Screen>
  )
}

function NavRow({ description, icon, label, onPress }: Readonly<{
  description: string
  icon: IconName
  label: string
  onPress(): void
}>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Icon color={colors.primary} name={icon} size={22} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text numberOfLines={2} style={styles.rowDescription}>{description}</Text>
      </View>
      <Icon color={colors.muted} name="chevron" size={18} />
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  identity: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  deviceMark: { alignItems: 'center', justifyContent: 'center', width: 88, height: 88, borderRadius: 28, backgroundColor: colors.primarySoft, marginBottom: spacing.md },
  deviceCaption: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  deviceId: { color: colors.text, fontSize: 25, fontWeight: '700', textAlign: 'center' },
  connectionStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  connectionLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  connectedLabel: { color: colors.success },
  identityNote: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  group: { backgroundColor: colors.panel, borderRadius: radius.lg, overflow: 'hidden' },
  row: { minHeight: 76, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.lg, flexDirection: 'row', alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: spacing.xs },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowDescription: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pressed: { backgroundColor: colors.panelElevated },
  warning: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md },
  warningText: { flex: 1, color: colors.warning, fontSize: 13, lineHeight: 20 },
  safetyControl: { gap: spacing.sm, paddingTop: spacing.sm },
  safetyNote: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
})
