import { diagnoseDeviceTransportClose } from '@/gateway/deviceTransportDiagnostic'

describe('device transport diagnostic', () => {
  test.each([
    ['timeout', 'connection_timeout'],
    ['Unable to resolve host gateway.example.com', 'dns_resolution_failed'],
    ['SSLHandshakeException: Trust anchor not found', 'tls_failed'],
    ["Expected HTTP 101 response but was '403 Forbidden'", 'upgrade_rejected'],
    ['No route to host', 'network_unreachable'],
    ['Software caused connection abort', 'connection_reset'],
    ['Failed to connect to gateway.example.com', 'connection_refused'],
  ] as const)('把原生 reason %s 压缩为固定分类 %s', (reason, kind) => {
    expect(diagnoseDeviceTransportClose(
      { code: 1006, reason },
      'socket_opening',
    )).toEqual({
      closeCode: 1006,
      kind,
      stage: 'socket_opening',
    })
  })

  test('未知原始异常不会进入快照，并丢弃非法 close code', () => {
    const secret = 'Bearer must-not-project https://gateway.example.com/?api_key=secret'
    const diagnostic = diagnoseDeviceTransportClose(
      { code: Number.POSITIVE_INFINITY, reason: secret },
      'gateway_handshake',
    )

    expect(diagnostic).toEqual({
      closeCode: null,
      kind: 'unknown',
      stage: 'gateway_handshake',
    })
    expect(JSON.stringify(diagnostic)).not.toContain('must-not-project')
    expect(JSON.stringify(diagnostic)).not.toContain('api_key')
  })

  test('close code 只接受 WebSocket 合法范围', () => {
    expect(diagnoseDeviceTransportClose(
      { code: 999, reason: '' },
      'session',
    ).closeCode).toBeNull()
    expect(diagnoseDeviceTransportClose(
      { code: 4_999, reason: '' },
      'session',
    ).closeCode).toBe(4_999)
  })
})
