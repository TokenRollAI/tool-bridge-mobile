import { validateAllowedMediaSource } from '../sourcePolicy'

const allowlist = new Set(['media.example.com'])

describe('validateAllowedMediaSource', () => {
  test('只返回规范化 URL 与 hostname', () => {
    expect(validateAllowedMediaSource(
      'https://MEDIA.example.com:443/audio/track.mp3?ticket=opaque',
      allowlist,
    )).toEqual({
      host: 'media.example.com',
      url: 'https://media.example.com/audio/track.mp3?ticket=opaque',
    })
  })

  test.each([
    'http://media.example.com/track.mp3',
    'https://user:password@media.example.com/track.mp3',
    'https://media.example.com:8443/track.mp3',
    'https://media.example.com/track.mp3#secret',
    'https://127.0.0.1/track.mp3',
    'https://[::1]/track.mp3',
    'https://attacker.example/track.mp3',
  ])('拒绝非 allowlist 安全边界: %s', url => {
    expect(() => validateAllowedMediaSource(url, allowlist)).toThrow()
  })
})
