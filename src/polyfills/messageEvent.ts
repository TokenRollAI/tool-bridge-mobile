type MessageEventHost = Readonly<{
  Event: typeof Event
  MessageEvent: typeof MessageEvent | undefined
}>

function createMessageEventConstructor(EventConstructor: typeof Event): typeof MessageEvent {
  class ReactNativeMessageEvent extends EventConstructor {
    readonly data: unknown
    readonly lastEventId: string
    readonly origin: string
    readonly ports: readonly MessagePort[]
    readonly source: MessageEventSource | null

    constructor(type: string, init: MessageEventInit = {}) {
      super(type, init)
      this.data = init.data ?? null
      this.lastEventId = init.lastEventId ?? ''
      this.origin = init.origin ?? ''
      this.ports = init.ports === undefined ? [] : [...init.ports]
      this.source = init.source ?? null
    }
  }

  return ReactNativeMessageEvent as unknown as typeof MessageEvent
}

/**
 * PartySocket 1.3.0 在 React Native 分支会直接构造全局 MessageEvent，
 * 但 Hermes 没有暴露这个全局类。只在缺失时安装最小 Web API 兼容层。
 */
export function installMessageEventPolyfill(
  host: MessageEventHost = globalThis,
): boolean {
  if (typeof host.MessageEvent === 'function') return false

  Object.defineProperty(host, 'MessageEvent', {
    configurable: true,
    value: createMessageEventConstructor(host.Event),
    writable: true,
  })
  return true
}

installMessageEventPolyfill()
