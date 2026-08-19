import { buildMapTarget, summarizeMapTarget } from '../mapTargetBuilder'
import { openMapArgumentsSchema } from '../openMapSchema'

describe('open_map schema 与 platform target builder', () => {
  test('Android geo URI 只来自结构化坐标并严格编码 label', () => {
    const argumentsValue = openMapArgumentsSchema.parse({
      purpose: '查看会面地点',
      target: {
        kind: 'coordinate',
        label: 'A&B? (东门)',
        latitude: 31.230416,
        longitude: 121.473701,
        zoom: 17,
      },
    })

    expect(buildMapTarget('android', argumentsValue.target)).toEqual({
      provider: 'android_geo_handler',
      uri: 'geo:0,0?q=31.230416%2C121.473701%28A%26B%3F%20%28%E4%B8%9C%E9%97%A8%29%29&z=17',
    })
    expect(summarizeMapTarget(argumentsValue.target)).toBe('A&B? (东门)')
  })

  test('iOS 只构造固定 maps.apple.com HTTPS link', () => {
    const target = openMapArgumentsSchema.parse({
      purpose: '查看地址',
      target: { kind: 'query', query: '1 Infinite Loop & lobby?' },
    }).target

    expect(buildMapTarget('ios', target)).toEqual({
      provider: 'apple_map_link',
      uri: 'https://maps.apple.com/?q=1%20Infinite%20Loop%20%26%20lobby%3F',
    })
  })

  test.each([
    { purpose: 'x', target: { kind: 'coordinate', latitude: 91, longitude: 0 } },
    { purpose: 'x', target: { kind: 'coordinate', latitude: 0, longitude: -181 } },
    { purpose: 'x', target: { kind: 'coordinate', latitude: Number.NaN, longitude: 0 } },
    { purpose: 'x', target: { kind: 'query', query: 'safe', url: 'https://attacker.example' } },
    { purpose: 'x', target: { kind: 'query', query: 'safe\u202eexe' } },
    { purpose: 'x', target: { kind: 'query', query: 'q'.repeat(201) } },
    { purpose: 'x\nspoof', target: { kind: 'query', query: 'safe' } },
  ])('拒绝越界、控制字符和 raw URL/未知字段: %#', value => {
    expect(openMapArgumentsSchema.safeParse(value).success).toBe(false)
  })
})
