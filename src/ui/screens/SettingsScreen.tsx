import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

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
  onOpenActivity(): void
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
  onOpenActivity,
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
  const connectionLabel = connected ? '已连接网关' : snapshot.transportState === 'suspended' ? '连接已暂停' : '网关尚未就绪'
  const deviceId = snapshot.deviceId ?? snapshot.defaultDeviceId
  const availableCount = snapshot.capabilities.filter(item => item.availability.status === 'available').length

  useDiscreteAccessibilityAnnouncement(
    `device-control:${snapshot.controlMode}`,
    `控制模式已变为 ${MODE_LABELS[snapshot.controlMode]}`,
  )

  return (
    <Screen focused={focused} title="设备">
      <View style={styles.identity}>
        <Text style={styles.deviceCaption}>本机设备 ID</Text>
        <Text selectable accessibilityHint={deviceId === null ? undefined : '长按设备 ID 可复制'} style={styles.deviceId}>
          {deviceId ?? '设备身份准备中'}
        </Text>
        <View style={styles.connectionStatus}>
          <View style={[styles.connectionPill, connected ? styles.connectedPill : null]}>
            <Icon color={connected ? colors.success : colors.muted} name={connected ? 'positive' : 'connection'} size={14} />
            <Text style={[styles.connectionLabel, connected ? styles.connectedLabel : null]}>{connectionLabel}</Text>
          </View>
          {snapshot.gatewayOrigin === null ? null : (
            <Text style={styles.gateway}>{snapshot.gatewayOrigin.replace(/^https:\/\//u, '')}</Text>
          )}
        </View>
      </View>

      {disabled ? (
        <View style={styles.locked}>
          <Text style={styles.lockedTitle}>远程能力已停用</Text>
          <Text style={styles.safetyNote}>新命令当前均被拒绝。恢复后，仍需在本机逐次确认。</Text>
        </View>
      ) : null}

      {snapshot.controlMode === 'direct_call' ? (
        <View style={styles.warning}>
          <Icon color={colors.warning} name="warning" size={18} />
          <Text style={styles.warningText}>直接调用已开启，包括高风险命令。系统权限与设备限制仍然有效；可随时紧急停用。</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeading title="连接与授权" />
        <View style={styles.group}>
          <NavRow description={disabled ? '恢复为每次确认后可编辑' : '网关地址和本机凭证'} icon="connection" label="连接配置" onPress={onOpenConnection} />
          <NavRow description={MODE_LABELS[snapshot.controlMode]} icon="shield" label="授权与安全" onPress={onOpenControls} />
        </View>
      </View>
      <View style={styles.section}>
        <SectionHeading title="能力与运行" />
        <View style={styles.group}>
          <NavRow description={`${availableCount} 项可用 · ${snapshot.capabilities.length} 项已探测`} icon="capabilities" label="设备能力" onPress={onOpenCapabilities} />
          <NavRow description="连接状态、设备提示与计时器" icon="home" label="运行详情" onPress={onOpenStatus} />
          <NavRow description={snapshot.mediaSession === null ? '当前没有媒体会话' : snapshot.mediaSession.title} icon="media" label="媒体会话" onPress={onOpenMedia} />
          <NavRow description="查看调用记录与本地执行结果" icon="activity" label="活动记录" onPress={onOpenActivity} />
        </View>
      </View>

      <View style={styles.safetyControl}>
        <AccessibleAction
          accessibilityHint={disabled ? '恢复为每条有副作用命令都在设备上确认' : '立即拒绝新命令并停止仍可撤销的本地副作用'}
          icon={disabled ? 'positive' : 'disabled'}
          label={disabled ? '恢复为每次确认' : '紧急停用远程能力'}
          onPress={disabled ? onEnable : onEmergencyDisable}
          variant={disabled ? 'primary' : 'danger'}
        />
        {disabled ? null : <Text style={styles.safetyNote}>立即拒绝新命令，并停止仍可撤销的本地操作。</Text>}
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
      <Icon color={colors.muted} name={icon} size={18} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text numberOfLines={2} style={styles.rowDescription}>{description}</Text>
      </View>
      <Icon color={colors.muted} name="chevron" size={18} />
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  identity: { gap: spacing.xs },
  deviceCaption: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  deviceId: { color: colors.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 21, fontWeight: '600' },
  connectionStatus: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
  connectionPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.panelElevated, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  connectedPill: { backgroundColor: colors.successSoft },
  connectionLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  connectedLabel: { color: colors.success },
  gateway: { color: colors.muted, flexShrink: 1, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
  section: { gap: spacing.sm },
  locked: { backgroundColor: colors.dangerSoft, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  lockedTitle: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  group: { backgroundColor: colors.panel, borderRadius: radius.lg, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md, flexDirection: 'row', alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowDescription: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  pressed: { backgroundColor: colors.panelElevated },
  warning: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md },
  warningText: { flex: 1, color: colors.warning, fontSize: 13, lineHeight: 20 },
  safetyControl: { gap: spacing.sm, paddingTop: spacing.sm },
  safetyNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
})
