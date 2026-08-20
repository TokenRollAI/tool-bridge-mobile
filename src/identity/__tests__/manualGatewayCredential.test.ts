import {
  createManualGatewayCredential,
  normalizeManualGatewayOrigin,
} from '../manualGatewayCredential'

const identity = {
  defaultDeviceId: 'a1b2c3d4e5f6',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
}

describe('manual gateway credential', () => {
  test('把 URL 与 API key 转成 audience 绑定的本机稳定 credential，默认用 seeded 设备 ID', () => {
    expect(createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      origin: ' https://gateway.example.com/ ',
    }, identity)).toEqual({
      audienceOrigin: 'https://gateway.example.com',
      deviceId: 'a1b2c3d4e5f6',
      keyId: 'manual_api_key_00000000-0000-4000-8000-000000000000',
      material: 'tb_sk_local_test_01',
      version: 1,
    })
  })

  test('接受用户自定义设备 ID 并去除首尾空白', () => {
    expect(createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      deviceId: ' my-phone.01 ',
      origin: 'https://gateway.example.com',
    }, identity)).toMatchObject({ deviceId: 'my-phone.01' })
  })

  test('空白自定义设备 ID 回退到默认值', () => {
    expect(createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      deviceId: '   ',
      origin: 'https://gateway.example.com',
    }, identity)).toMatchObject({ deviceId: 'a1b2c3d4e5f6' })
  })

  test.each(['my phone', 'phone/01', '手机', 'a'.repeat(65), 'id\n01'])(
    '拒绝不符合网关 deviceId 字符集或长度的自定义设备 ID: %p',
    deviceId => {
      expect(() => createManualGatewayCredential({
        apiKey: 'tb_sk_local_test_01',
        deviceId,
        origin: 'https://gateway.example.com',
      }, identity)).toThrow('设备 ID')
    },
  )

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
      }, identity)).toThrow('API key')
    },
  )

  test('拒绝把任意标识冒充 installation identity', () => {
    expect(() => createManualGatewayCredential({
      apiKey: 'tb_sk_local_test_01',
      origin: 'https://gateway.example.com',
    }, { ...identity, installationId: 'phone_hardware_serial' })).toThrow('installationId 格式无效')
  })
})
