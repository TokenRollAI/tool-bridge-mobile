import { AppHandoffController } from '../controller'
import { validateAllowedAppUrl } from '../urlPolicy'

import type { AppLinkingAdapter } from '../linkingAdapter'

function createAdapter(canOpen = true) {
  const opened: string[] = []
  const adapter: AppLinkingAdapter = {
    canOpen: async () => canOpen,
    open: async url => { opened.push(url) },
    probe: () => true,
  }
  return { adapter, opened }
}

describe('AppHandoffController', () => {
  test('handoff 只报告 handed_off 与脱敏 target', async () => {
    const fixture = createAdapter()
    const controller = new AppHandoffController(
      fixture.adapter,
      new Set(['www.example.com']),
    )
    const result = await controller.open(
      'https://www.example.com/path?ticket=secret',
      new AbortController().signal,
      '2099-08-19T00:00:00.000Z',
    )

    expect(result).toEqual({
      status: 'handed_off',
      target: { host: 'www.example.com', kind: 'https' },
    })
    expect(JSON.stringify(result)).not.toContain('ticket=secret')
    expect(fixture.opened).toEqual(['https://www.example.com/path?ticket=secret'])
  })

  test('系统不能处理或命令已取消时不调用 open', async () => {
    const unavailable = createAdapter(false)
    const controller = new AppHandoffController(
      unavailable.adapter,
      new Set(['www.example.com']),
    )
    await expect(controller.open(
      'https://www.example.com/path',
      new AbortController().signal,
      '2099-08-19T00:00:00.000Z',
    )).rejects.toMatchObject({ code: 'unavailable' })
    expect(unavailable.opened).toEqual([])

    const cancelled = createAdapter(true)
    const abortController = new AbortController()
    abortController.abort()
    await expect(new AppHandoffController(
      cancelled.adapter,
      new Set(['www.example.com']),
    ).open(
      'https://www.example.com/path',
      abortController.signal,
      '2099-08-19T00:00:00.000Z',
    )).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancelled.opened).toEqual([])
  })

  test('等待 canOpen 期间取消或到期都不会进入 open', async () => {
    let resolveCanOpen: (value: boolean) => void = () => undefined
    const opened: string[] = []
    const adapter: AppLinkingAdapter = {
      canOpen: () => new Promise(resolve => { resolveCanOpen = resolve }),
      open: async url => { opened.push(url) },
      probe: () => true,
    }
    let now = new Date('2026-08-19T00:00:00.000Z')
    const controller = new AppHandoffController(
      adapter,
      new Set(['www.example.com']),
      () => now,
    )
    const abortController = new AbortController()
    const cancelled = controller.open(
      'https://www.example.com/path',
      abortController.signal,
      '2026-08-19T00:01:00.000Z',
    )
    abortController.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    resolveCanOpen(true)
    expect(opened).toEqual([])

    const expired = controller.open(
      'https://www.example.com/path',
      new AbortController().signal,
      '2026-08-19T00:01:00.000Z',
    )
    now = new Date('2026-08-19T00:01:00.000Z')
    resolveCanOpen(true)
    await expect(expired).rejects.toMatchObject({ code: 'expired' })
    expect(opened).toEqual([])
  })

  test.each([
    'http://www.example.com/path',
    'https://user:password@www.example.com/path',
    'https://www.example.com:8443/path',
    'https://www.example.com/path#fragment',
    'https://127.0.0.1/path',
    'https://attacker.example/path',
  ])('安全预检拒绝非 allowlist URL: %s', url => {
    expect(() => validateAllowedAppUrl(url, new Set(['www.example.com']))).toThrow()
  })
})
