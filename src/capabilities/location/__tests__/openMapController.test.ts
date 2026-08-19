import { OpenMapController } from '../openMapController'

import type { MapHandoffAdapter } from '../mapHandoffAdapter'

function createAdapter(platform: 'android' | 'ios' | null = 'android') {
  let canOpen = true
  const opened: string[] = []
  const adapter: MapHandoffAdapter = {
    canOpen: async () => canOpen,
    open: async uri => { opened.push(uri) },
    platform: () => platform,
    probe: () => true,
  }
  return {
    adapter,
    opened,
    setCanOpen: (value: boolean) => { canOpen = value },
  }
}

const argumentsValue = {
  purpose: '查看会面地点',
  target: { kind: 'query' as const, query: 'Sensitive Street 123' },
}

describe('OpenMapController', () => {
  test('probe 使用实际 handler，成功只返回脱敏 handed_off', async () => {
    const fixture = createAdapter('android')
    const controller = new OpenMapController(fixture.adapter)

    await expect(controller.probe('active')).resolves.toEqual({ status: 'available' })
    const result = await controller.open(
      argumentsValue,
      new AbortController().signal,
      '2099-08-19T00:00:00.000Z',
    )

    expect(result).toEqual({
      status: 'handed_off',
      target: { kind: 'map', provider: 'android_geo_handler' },
    })
    expect(JSON.stringify(result)).not.toContain('Sensitive')
    expect(fixture.opened).toEqual(['geo:0,0?q=Sensitive%20Street%20123'])
  })

  test('后台、无平台或无 handler 时不可用且不打开', async () => {
    const fixture = createAdapter('ios')
    const controller = new OpenMapController(fixture.adapter)
    await expect(controller.probe('background')).resolves.toEqual({
      reason: 'foreground_required',
      status: 'unavailable',
    })
    fixture.setCanOpen(false)
    await expect(controller.open(
      argumentsValue,
      new AbortController().signal,
      '2099-08-19T00:00:00.000Z',
    )).rejects.toMatchObject({ code: 'unavailable' })
    expect(fixture.opened).toEqual([])

    await expect(new OpenMapController(createAdapter(null).adapter).probe('active')).resolves.toEqual({
      reason: 'map_platform_unsupported',
      status: 'unavailable',
    })
  })

  test('等待 canOpen 期间取消或到期均 zero open', async () => {
    let resolveCanOpen: (value: boolean) => void = () => undefined
    const opened: string[] = []
    const adapter: MapHandoffAdapter = {
      canOpen: () => new Promise(resolve => { resolveCanOpen = resolve }),
      open: async uri => { opened.push(uri) },
      platform: () => 'android',
      probe: () => true,
    }
    let now = new Date('2026-08-19T00:00:00.000Z')
    const controller = new OpenMapController(adapter, () => now)
    const abortController = new AbortController()
    const cancelled = controller.open(
      argumentsValue,
      abortController.signal,
      '2026-08-19T00:01:00.000Z',
    )
    abortController.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    resolveCanOpen(true)

    const expired = controller.open(
      argumentsValue,
      new AbortController().signal,
      '2026-08-19T00:01:00.000Z',
    )
    now = new Date('2026-08-19T00:01:00.000Z')
    resolveCanOpen(true)
    await expect(expired).rejects.toMatchObject({ code: 'expired' })
    expect(opened).toEqual([])
  })
})
