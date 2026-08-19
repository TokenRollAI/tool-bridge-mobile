import { redactForLog } from '../redact'

describe('redactForLog', () => {
  test('递归移除凭证、signed URL 和精确坐标', () => {
    expect(redactForLog({
      authorization: 'Bearer secret',
      nested: {
        latitude: 31.2,
        longitude: 121.4,
        signedUrl: 'https://object.example/?signature=secret',
        status: 'ok',
      },
      pushToken: 'provider-token',
    })).toEqual({
      authorization: '[REDACTED]',
      nested: {
        latitude: '[REDACTED]',
        longitude: '[REDACTED]',
        signedUrl: '[REDACTED]',
        status: 'ok',
      },
      pushToken: '[REDACTED]',
    })
  })
})
