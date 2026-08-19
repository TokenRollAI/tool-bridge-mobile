import { installMessageEventPolyfill } from '@/polyfills/messageEvent'

type MutableMessageEventHost = {
  Event: typeof Event
  MessageEvent: typeof MessageEvent | undefined
}

describe('MessageEvent React Native compatibility', () => {
  test('缺失时安装可承载 WebSocket data 的 MessageEvent', () => {
    const host: MutableMessageEventHost = {
      Event,
      MessageEvent: undefined,
    }

    expect(installMessageEventPolyfill(host)).toBe(true)
    if (host.MessageEvent === undefined) throw new Error('MessageEvent polyfill was not installed')

    const event = new host.MessageEvent('message', {
      data: '{"type":"ready"}',
      lastEventId: 'event_01',
      origin: 'https://gateway.example.com',
    })

    expect(event).toBeInstanceOf(Event)
    expect(event.type).toBe('message')
    expect(event.data).toBe('{"type":"ready"}')
    expect(event.lastEventId).toBe('event_01')
    expect(event.origin).toBe('https://gateway.example.com')
    expect(event.ports).toEqual([])
    expect(event.source).toBeNull()
  })

  test('已有平台 MessageEvent 时不覆盖', () => {
    const NativeMessageEvent = MessageEvent
    const host: MutableMessageEventHost = {
      Event,
      MessageEvent: NativeMessageEvent,
    }

    expect(installMessageEventPolyfill(host)).toBe(false)
    expect(host.MessageEvent).toBe(NativeMessageEvent)
  })
})
