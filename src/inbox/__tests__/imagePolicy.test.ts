import { validateInboxImageSource } from '../imagePolicy'

describe('validateInboxImageSource', () => {
  test('接受任意 hostname 并返回规范化的 HTTPS URL', () => {
    expect(validateInboxImageSource(
      'https://IMG.example.com:443/chart.png?token=opaque',
    )).toEqual({
      host: 'img.example.com',
      url: 'https://img.example.com/chart.png?token=opaque',
    })
    expect(validateInboxImageSource('https://other.example.net/chart.png').host)
      .toBe('other.example.net')
  })

  test.each([
    'not a URL',
    'http://img.example.com/chart.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///private/chart.png',
    'https://user:password@img.example.com/chart.png',
    'https://img.example.com:8443/chart.png',
    'https://img.example.com/chart.png#secret',
    'https://127.0.0.1/chart.png',
    'https://[::1]/chart.png',
  ])('拒绝不安全图片来源: %s', url => {
    expect(() => validateInboxImageSource(url)).toThrow()
  })
})
