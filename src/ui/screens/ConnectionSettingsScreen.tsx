import { StyleSheet, Text, View } from 'react-native'

import { GatewayConfigurationCard } from '@/ui/components/GatewayConfigurationCard'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { radius, spacing, useTheme, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'
import type { ApplicationSnapshot } from '@/runtime/applicationRuntime'

export function ConnectionSettingsScreen({ focused = true, onBack, onClear, onSave, snapshot }: Readonly<{
  focused?: boolean
  onBack(): void
  onClear(): Promise<void>
  onSave(input: ManualGatewayConfigurationInput): Promise<void>
  snapshot: ApplicationSnapshot
}>) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const connected = snapshot.transportState === 'ready'
  return (
    <Screen backLabel="设备" focused={focused} onBack={onBack} title="连接配置" tone="reading">
      <View style={styles.status}>
        <Icon color={connected ? colors.success : colors.muted} name="connection" size={28} />
        <View style={styles.statusCopy}>
          <Text style={styles.title}>{connected ? '已连接网关' : '网关尚未就绪'}</Text>
          <Text style={styles.description}>{connected ? '设备连接已就绪，执行仍受本机授权约束。' : '保存网关配置后，设备会尝试建立连接。'}</Text>
        </View>
      </View>
      {snapshot.controlMode === 'disabled' ? (
        <Text style={styles.description}>远程能力已停用。请返回设备页恢复为每次确认后，再调整连接配置。</Text>
      ) : (
        <GatewayConfigurationCard appearance="page" currentOrigin={snapshot.gatewayOrigin} defaultDeviceId={snapshot.defaultDeviceId} onClear={onClear} onSave={onSave} />
      )}
    </Screen>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  statusCopy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 22 },
})
