export type DeviceTransportFailureKind =
  | 'abnormal_close'
  | 'connection_refused'
  | 'connection_reset'
  | 'connection_timeout'
  | 'dns_resolution_failed'
  | 'network_unreachable'
  | 'tls_failed'
  | 'upgrade_rejected'
  | 'unknown'

export type DeviceTransportFailureStage =
  | 'gateway_handshake'
  | 'session'
  | 'socket_opening'

export type DeviceTransportDiagnostic = Readonly<{
  closeCode: number | null
  kind: DeviceTransportFailureKind
  stage: DeviceTransportFailureStage
}>

function closeCodeFrom(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1_000
    && value <= 4_999
    ? value
    : null
}

function failureKindFrom(reason: string, closeCode: number | null): DeviceTransportFailureKind {
  if (
    reason.includes('timeout')
    || reason.includes('timed out')
  ) return 'connection_timeout'

  if (
    reason.includes('unable to resolve host')
    || reason.includes('unknown host')
    || reason.includes('unknownhost')
    || reason.includes('name or service not known')
    || reason.includes('no address associated with hostname')
  ) return 'dns_resolution_failed'

  if (
    reason.includes('certificate')
    || reason.includes('hostname not verified')
    || reason.includes('ssl')
    || reason.includes('tls')
    || reason.includes('trust anchor')
  ) return 'tls_failed'

  if (
    reason.includes('expected http 101')
    || reason.includes('response code')
    || reason.includes('upgrade')
  ) return 'upgrade_rejected'

  if (
    reason.includes('network is unreachable')
    || reason.includes('no route to host')
  ) return 'network_unreachable'

  if (
    reason.includes('connection reset')
    || reason.includes('broken pipe')
    || reason.includes('software caused connection abort')
  ) return 'connection_reset'

  if (
    reason.includes('connection refused')
    || reason.includes('failed to connect')
  ) return 'connection_refused'

  if (closeCode === 1006) return 'abnormal_close'
  return 'unknown'
}

/**
 * 把原生 WebSocket close 事件压缩成固定枚举。原始 reason 只在当前调用栈内参与
 * 分类，不得写入运行时快照、日志或 UI。
 */
export function diagnoseDeviceTransportClose(
  event: Readonly<{ code?: unknown; reason?: unknown }>,
  stage: DeviceTransportFailureStage,
): DeviceTransportDiagnostic {
  const reason = typeof event.reason === 'string'
    ? event.reason.slice(0, 512).toLowerCase().trim()
    : ''
  const closeCode = closeCodeFrom(event.code)
  return {
    closeCode,
    kind: failureKindFrom(reason, closeCode),
    stage,
  }
}
