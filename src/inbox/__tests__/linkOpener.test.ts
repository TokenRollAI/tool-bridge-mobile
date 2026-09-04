import { SafeInboxLinkOpener, validateInboxLink } from '../linkOpener'

import type { InboxLinkingAdapter } from '../linkOpener'

function createAdapter(overrides: Partial<InboxLinkingAdapter> = {}): InboxLinkingAdapter {
  return {
    open: jest.fn(async () => undefined),
    ...overrides,
  }
}

describe('信箱 Markdown 链接', () => {
  test('只接受结构合规的 HTTPS hostname，并保留 query 与 fragment', () => {
    expect(validateInboxLink('https://Docs.Example.com/path?q=1#intro')).toEqual({
      host: 'docs.example.com',
      url: 'https://docs.example.com/path?q=1#intro',
    })
    expect(() => validateInboxLink('http://docs.example.com')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink('mailto:user@example.com')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink('https://user:pass@docs.example.com')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink('https://docs.example.com:8443')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink('https://127.0.0.1/admin')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink('https://[::1]/admin')).toThrow('HTTPS hostname')
    expect(() => validateInboxLink(`https://docs.example.com/${'a'.repeat(2_100)}`))
      .toThrow('2048')
  })

  test('打开前复检 URL，再直接交给原生 Linking', async () => {
    const adapter = createAdapter()
    const opener = new SafeInboxLinkOpener(adapter)

    await opener.open('https://docs.example.com/guide')

    expect(adapter.open).toHaveBeenCalledWith('https://docs.example.com/guide')
  })

  test('运行时复检失败时不调用原生 Linking', async () => {
    const adapter = createAdapter()
    const opener = new SafeInboxLinkOpener(adapter)

    await expect(opener.open('tool-bridge://open')).rejects.toThrow('HTTPS hostname')
    expect(adapter.open).not.toHaveBeenCalled()
  })

  test('原生 Linking 拒绝时向 UI 透传失败', async () => {
    const adapter = createAdapter({
      open: jest.fn(async () => { throw new Error('native unavailable') }),
    })
    const opener = new SafeInboxLinkOpener(adapter)

    await expect(opener.open('https://docs.example.com/guide')).rejects.toThrow('native unavailable')
    expect(adapter.open).toHaveBeenCalledTimes(1)
  })
})
