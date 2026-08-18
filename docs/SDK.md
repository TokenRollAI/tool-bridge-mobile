# SDK 使用与集成边界

状态：当前事实 + 上游 SDK 提案。

## 1. 结论先行

当前公开包 `@tool-bridge/sdk` **不能直接作为 React Native App 的设备客户端使用**。

原因来自当前代码和 package contract：

- package 声明 `node >= 22`；
- `connect()` 使用 Node 的 `ws` 和 `partysocket/ws`；
- WebSocket 鉴权通过 Node 握手 `Authorization: Bearer <sk>` 注入；
- SDK 的主职责是把一个 Node / Workers Tool Bridge 实例嵌入宿主，再反向连接网关；
- React Native 的 WebSocket 面和后台生命周期不满足上述 Node 假设。

因此：

- 移动 App 不直接依赖当前 `@tool-bridge/sdk` runtime；
- 当前 SDK 可用于本仓库的 Node 协议 fixture、fake device 和网关契约测试；
- 移动生产代码等待/推动上游发布公共的跨运行时 device client；
- 禁止把 `@tool-bridge/core` 私有源码复制到本仓库长期维护。

## 2. 当前 `@tool-bridge/sdk` 能做什么

当前公开面：

```ts
import {
  createToolBridge,
  MemoryStateStore,
} from '@tool-bridge/sdk'

const tb = createToolBridge({
  state: new MemoryStateStore(),
  adminSk: process.env.TB_ADMIN_SK,
})

tb.registerTool('tools/echo', {
  List: () => [{
    name: 'echo',
    description: '原样返回 text',
  }],
  Call: (_name, args) => ({
    content: { echoed: args.text },
  }),
})

const connection = tb.connect(
  'https://gateway.example.com',
  process.env.TB_DEVICE_SK,
  { deviceId: 'fixture-phone-01' },
)

await connection.ready
```

在本仓库中的合法用途：

1. 启动一个 Node fake device，验证网关挂载路径和 call/result；
2. 生成协议 fixture，验证移动 client 编解码兼容；
3. 在 CI 中做上游发布版本的黑盒兼容测试；
4. 模拟断线、重复 call id、拒绝帧和心跳。

它不能替代：

- APNs / FCM 注册；
- command mailbox；
- 本地用户确认；
- iOS / Android 生命周期；
- 原生权限；
- React Native WebSocket ticket 鉴权。

## 3. 当前 device wire 契约

当前协议由上游定义，移动端需要兼容：

### 设备到网关

```ts
type HelloFrame = {
  type: 'hello'
  deviceId: string
  mountPath?: string
  expose: DeviceExpose
}

type ResultFrame =
  | { type: 'result'; id: string; ok: true; value: unknown }
  | { type: 'result'; id: string; ok: false; error: TBErrorBody }
```

### 网关到设备

```ts
type ReadyFrame = {
  type: 'ready'
  mountPath: string
}

type CallFrame = {
  type: 'call'
  id: string
  path: string
  tool: string
  arguments: Record<string, unknown>
}

type ErrorFrame = {
  type: 'error'
  error: TBErrorBody
}
```

双向还有 `ping`、`pong`，网关可发送 `cancel`。当前客户端对重复 call id 缓存并回放首次
result，这是移动端幂等的最低兼容要求，但 mailbox 副作用仍需持久化去重。

## 4. 目标公共包

建议由 `TokenRollAI/tool-bridge` 发布：

```text
@tool-bridge/device-client
```

包必须：

- 只依赖 Web 标准或显式注入 transport；
- 支持 React Native、浏览器扩展、Node；
- 导出协议 schema、类型、编解码和纯状态机；
- 不内置 SecureStore、push、SQLite 或平台 UI；
- 不读取 `process.env`；
- 不要求 Node built-in；
- 对 ESM 和 React Native bundler 有明确 exports；
- 提供版本协商与兼容矩阵。

建议模块边界：

```text
@tool-bridge/device-client
  ├── protocol      frames、schema、error
  ├── session       hello / ready / call / result 状态机
  ├── realtime      注入 WebSocket transport
  ├── mailbox       注入 HTTP transport
  └── testing       fixture 与 fake clock
```

## 5. 目标移动端用法

下面是**提案 API**，用于约定期望开发体验；在上游包发布前不可复制到生产代码并声称已可运行。

```ts
import {
  createDeviceClient,
  type DeviceCommand,
} from '@tool-bridge/device-client'

const client = createDeviceClient({
  identity: {
    deviceId,
    mountPath: `device/${deviceId}`,
  },
  capabilitySource: {
    snapshot: () => capabilityRegistry.describeAll(),
    subscribe: listener => capabilityRegistry.subscribe(listener),
  },
  transports: {
    realtime: createReactNativeRealtimeTransport({
      getTicket: () => gateway.createWebSocketTicket(),
    }),
    mailbox: createMailboxTransport({
      fetch: globalThis.fetch,
      getCredential: () => credentialStore.get(),
    }),
  },
  commandStore,
  onCommand: async (command: DeviceCommand, signal: AbortSignal) => {
    const decision = await policyEngine.authorize(command)
    return capabilityRegistry.execute(decision, signal)
  },
})

await client.start()
```

移动仓库负责的 adapter：

- `credentialStore`：SecureStore / native key storage；
- `commandStore`：SQLite 持久化幂等；
- `createReactNativeRealtimeTransport`：AppState-aware WebSocket；
- `policyEngine`：本地模式、权限和确认；
- `capabilityRegistry`：原生能力路由。

公共包负责：

- 帧 schema 与 decode/encode；
- session 状态机；
- call id 去重的通用语义；
- 重连策略基础；
- mailbox API client；
- 标准错误和协议版本。

## 6. WebSocket 鉴权

### 当前问题

Node 客户端可在 WebSocket 握手加入 `Authorization` header，React Native / 浏览器标准 WebSocket
不能把这个能力当成可移植契约。长期 SK 也不能放到 URL query，因为 URL 更容易进入代理和日志。

### 推荐方案：短期 ticket

1. App 用 HTTPS `Authorization` 调用网关 ticket endpoint；
2. 网关返回单次、短 TTL、绑定 deviceId/audience 的 opaque ticket；
3. App 用 ticket 建立 WebSocket；
4. 网关验证并消费 ticket；
5. 重连必须获取新 ticket。

ticket 即使进入 URL，也因单次、短期、窄 audience 降低泄漏影响；网关和代理仍必须对 query
做日志脱敏。

## 7. 能力注册示例

移动 App 只声明 `nodes`，永不声明 `shell` 或 `fs`：

```ts
const expose = {
  nodes: [
    {
      path: 'phone/attention',
      kind: 'tool',
      description: '让设备产生用户可见的声光振动提示',
      cmds: [
        {
          name: 'ring',
          description: '让设备短时响铃，帮助用户找到它',
          effect: 'write',
          confirm: false,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              durationSeconds: {
                type: 'integer',
                minimum: 1,
                maximum: 120,
              },
              vibrate: { type: 'boolean' },
              flash: { type: 'boolean' },
            },
          },
        },
      ],
    },
  ],
}
```

`confirm: false` 只代表工具的网关元数据默认值；设备本地策略仍可以要求确认。更丰富的
confirmation/availability 元数据在 HTBP 正式化前不能私自塞入字段并假设所有消费者理解。

## 8. Handler 约定

handler 必须按以下顺序工作：

1. 解析并校验 path/tool；
2. 用 commandId 检查本地终态；
3. 检查 expiresAt / cancellation；
4. 重新探测权限与前后台条件；
5. 执行本地策略；
6. 需要时进入等待用户状态；
7. 持久化执行意图；
8. 调用 capability；
9. 持久化结果；
10. 返回小结果或 objectRef。

禁止：

- 直接用 `as` 把未知 arguments 断言成业务类型；
- 捕获所有错误后返回 `{ ok: true }`；
- 因 WebSocket 重连重复执行；
- 把原生错误堆栈、文件路径或凭证发给 Agent。

## 9. 版本和兼容

App hello/profile 应携带：

- `protocolVersion`；
- `clientVersion`；
- `capabilityProfileVersion`；
- `platform` 和 OS major；
- 可选 feature flags。

兼容原则：

- 协议新增可选字段走向后兼容；
- 改变既有字段语义必须升协议版本；
- App 至少支持当前和上一稳定协议版本；
- 网关拒绝不支持版本时返回明确升级提示；
- 上游 SDK 升级必须先过 fixture + fake gateway + 真机 smoke。

## 10. 上游 SDK 验收清单

- React Native Metro 可无 polyfill 导入；
- 包入口不引用 Node built-in、`ws` 或 `process.env`；
- 注入 fake transport 可覆盖完整状态机；
- 标准 WebSocket adapter 与 Node adapter 都有测试；
- duplicate call、disconnect、reconnect、cancel、invalid frame 有契约测试；
- mailbox claim/ack/result 支持 crash recovery；
- 所有 frame 通过同一份 schema 验证；
- README 明确 credential ownership 和日志脱敏；
- package exports、types 和 source map 正确；
- 示例不会把长期 SK 放 URL。
