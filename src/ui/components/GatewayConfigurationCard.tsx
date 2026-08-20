import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '@/ui/accessibility'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { StatusCard, StatusRow } from '@/ui/components/StatusCard'
import { colors } from '@/ui/theme'

import type { ManualGatewayConfigurationInput } from '@/identity/manualGatewayCredential'

type GatewayConfigurationCardProps = Readonly<{
  currentOrigin: string | null
  defaultDeviceId: string | null
  onClear(): Promise<void>
  onSave(input: ManualGatewayConfigurationInput): Promise<void>
}>

function safeFeedback(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function GatewayConfigurationCard({
  currentOrigin,
  defaultDeviceId,
  onClear,
  onSave,
}: GatewayConfigurationCardProps) {
  const [apiKey, setApiKey] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [deviceIdInput, setDeviceIdInput] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [originDirty, setOriginDirty] = useState(false)
  const [originInput, setOriginInput] = useState('')
  const displayedOrigin = originDirty ? originInput : (currentOrigin ?? '')

  useDiscreteAccessibilityAnnouncement(
    feedback === null ? null : `gateway-config:${feedback}`,
    feedback,
    feedback?.startsWith('无法') === true ? 'assertive' : 'polite',
  )

  const save = async () => {
    if (isBusy) return
    setIsBusy(true)
    setFeedback(null)
    try {
      const customDeviceId = deviceIdInput.trim()
      await onSave({
        apiKey,
        origin: displayedOrigin,
        ...(customDeviceId === '' ? {} : { deviceId: customDeviceId }),
      })
      setApiKey('')
      setOriginDirty(false)
      setFeedback('连接配置已保存；App 会在前台通过官方 SDK 建立连接。')
    } catch (error) {
      setFeedback(safeFeedback(error, '无法保存连接配置；API key 未被确认写入。'))
    } finally {
      setIsBusy(false)
    }
  }

  const clear = async () => {
    if (isBusy) return
    setIsBusy(true)
    setFeedback(null)
    try {
      await onClear()
      setApiKey('')
      setOriginDirty(false)
      setConfirmingClear(false)
      setFeedback('已停止当前连接并清除本机 API key。')
    } catch (error) {
      setFeedback(safeFeedback(error, '无法确认 API key 已从系统安全存储清除。'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <StatusCard title="网关连接设置">
      <StatusRow label="当前 Gateway" value={currentOrigin ?? '未配置'} />
      <Text style={styles.body}>
        暂时使用手工 URL + API key，不经过 pairing。API key 只写入系统安全存储，界面不会回显。
      </Text>
      <Text style={styles.label}>Gateway HTTPS URL</Text>
      <TextInput
        accessibilityLabel="Gateway HTTPS URL"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isBusy}
        keyboardType="url"
        onChangeText={value => {
          setOriginInput(value)
          setOriginDirty(true)
        }}
        placeholder="https://gateway.example.com"
        placeholderTextColor={colors.muted}
        spellCheck={false}
        style={styles.input}
        value={displayedOrigin}
      />
      <Text style={styles.label}>API key</Text>
      <TextInput
        accessibilityHint="输入内容会被遮蔽，保存后立即从表单清空"
        accessibilityLabel="Tool Bridge API key"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isBusy}
        onChangeText={setApiKey}
        placeholder="输入 API key"
        placeholderTextColor={colors.muted}
        secureTextEntry
        spellCheck={false}
        style={styles.input}
        value={apiKey}
      />
      <Text style={styles.label}>设备 ID（可选）</Text>
      <TextInput
        accessibilityHint="留空时使用由本机硬件标识派生的稳定默认值；挂载路径为 device/phone/设备ID"
        accessibilityLabel="自定义设备 ID"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isBusy}
        onChangeText={setDeviceIdInput}
        placeholder={defaultDeviceId === null ? '留空使用默认设备 ID' : `留空使用默认 ${defaultDeviceId}`}
        placeholderTextColor={colors.muted}
        spellCheck={false}
        style={styles.input}
        value={deviceIdInput}
      />
      <Text style={styles.hint}>
        只能包含字母、数字、“.”、“_”或“-”，最长 64 个字符；设备将挂载到 device/phone/设备ID。
      </Text>
      <AccessibleAction
        accessibilityHint="先停止旧连接，再把 API key 写入系统安全存储并连接这个 Gateway"
        busy={isBusy}
        disabled={displayedOrigin.trim() === '' || apiKey === ''}
        label="保存 Gateway URL 和 API key 并连接"
        onPress={() => { void save() }}
        style={styles.saveButton}
        visualLabel={isBusy ? '正在保存…' : '保存并连接'}
      />

      {currentOrigin === null ? null : confirmingClear ? (
        <View style={styles.confirmation}>
          <Text accessibilityRole="header" style={styles.confirmationTitle}>
            确认清除本机连接配置？
          </Text>
          <Text style={styles.body}>
            这会先停止当前 SDK 连接，再删除 SecureStore 中的 API key；不会删除本地命令、防重放记录、计时器或活动历史。构建预置 URL 如存在仍会保留。
          </Text>
          <View style={styles.actionRow}>
            <AccessibleAction
              busy={isBusy}
              label="取消清除网关连接配置"
              onPress={() => { setConfirmingClear(false) }}
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              visualLabel="取消"
            />
            <AccessibleAction
              accessibilityHint="停止连接并删除系统安全存储中的 API key"
              busy={isBusy}
              label="确认清除网关连接配置"
              onPress={() => { void clear() }}
              style={styles.clearButton}
              visualLabel={isBusy ? '正在清除…' : '确认清除'}
            />
          </View>
        </View>
      ) : (
        <AccessibleAction
          accessibilityHint="先显示清除范围确认，不会立即删除 API key"
          busy={isBusy}
          label="清除网关连接配置"
          onPress={() => {
            setFeedback(null)
            setConfirmingClear(true)
          }}
          style={styles.secondaryButton}
          textStyle={styles.secondaryButtonText}
        />
      )}

      {feedback === null ? null : <Text style={styles.feedback}>{feedback}</Text>}
    </StatusCard>
  )
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  clearButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    flex: 1,
  },
  confirmation: {
    borderColor: colors.danger,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  confirmationTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  feedback: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    borderColor: colors.outline,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  secondaryButton: {
    borderColor: colors.outline,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
  },
  secondaryButtonText: {
    color: colors.text,
  },
})
