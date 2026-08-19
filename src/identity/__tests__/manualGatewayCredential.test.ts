import {
  createManualGatewayCredential,
  normalizeManualGatewayOrigin,
} from '../manualGatewayCredential'

const installationId = 'installation_00000000-0000-4000-8000-000000000000'

describe('manual gateway credential', () => {
  test('把 URL 与 API key 转成 audience 绑定的本机稳定 credential', () => {
    expect(createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      origin: ' https://gateway.example.com/ ',
    }, installationId)).toEqual({
      audienceOrigin: 'https://gateway.example.com',
      deviceId: 'mobile_00000000-0000-4000-8000-000000000000',
      keyId: 'manual_api_key_00000000-0000-4000-8000-000000000000',
      material: 'tb_sk_local_test_01',
      version: 1,
    })
  })

  test.each([
    'http://gateway.example.com',
    'https://user@gateway.example.com',
    'https://gateway.example.com/system/device',
    'https://gateway.example.com?token=secret',
    'https://gateway.example.com/#fragment',
  ])('拒绝不是纯 HTTPS origin 的 URL: %s', value => {
    expect(() => normalizeManualGatewayOrigin(value)).toThrow('HTTPS origin')
  })

  test.each(['', ' key', 'key ', 'key value', 'key\nvalue', '密钥'])(
    '拒绝不适合作为 Authorization token 的 API key: %p',
    apiKey => {
      expect(() => createManualGatewayCredential({
        apiKey,
        origin: 'https://gateway.example.com',
      }, installationId)).toThrow('API key')
    },
  )

  test('拒绝把任意标识冒充 installation identity', () => {
    expect(() => createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      origin: 'https://gateway.example.com',
    }, 'phone_hardware_serial')).toThrow('installationId 格式无效')
  })
})
