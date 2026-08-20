# SDK 使用与集成边界

状态：`@tool-bridge/sdk/device@0.11.0` 已接入移动端；首页 URL + API key 内测入口已实现，pairing、短期
ticket、mailbox 与动态 profile 仍未实现。

## 1. 当前结论

自 `@tool-bridge/sdk@0.11.0` 起，上游通过独立子入口提供 React Native / Hermes-safe 设备客户端：

```ts
import {
  connectDevice,
  createReactNativeWebSocketFactory,
} from '@tool-bridge/sdk/device'
```

本仓库已经精确锁定并使用该版本。当前移动适配层：

- 使用官方 `DeviceExpose`、hello / ready / call / result、ping / pong、cancel 与重连状态机；
- 通过 React Native WebSocket 第三个参数注入 `Authorization` header，长期 SK 不进入 URL；
- App 前台恢复连接，后台、inactive 与本地 Disabled 模式暂停连接；
- call 继续经过 SQLite command 去重、动态 probe、policy、本地确认、结果上限与脱敏审计；
- 网关拒绝凭证后清除 SecureStore envelope，凭证缺失或 audience 不匹配时 fail closed；
- 首页允许用户手工保存/清除 Gateway HTTPS origin 与 API key，保存或清除前先停止旧 transport；
- 首页只在 SDK 收到 `ready` 后显示 `online`。

`@tool-bridge/sdk` 包级 `engines.node` 仍是 `>=22`，包根入口也仍面向 Node。这里的 Node 版本约束作用于
pnpm 安装、TypeScript、Metro 与 CI 构建环境，不意味着 React Native 设备内运行 Node。移动生产代码必须
只从 `/device` 子入口导入；禁止从包根导入 `createToolBridge` 或 Node transport。

## 2. 当前移动端用法

生产 wiring 位于 `src/gateway/sdkDeviceTransport.ts`，等价于：

```ts
const connection = connectDevice({
  baseUrl: gatewayOrigin,
  deviceId: credential.deviceId,
  expose: () => capabilityRegistry.deviceExpose(),
  credentialProvider: {
    prepare: async () => {
      const current = await credentialStore.get()
      if (current === null) throw new Error('device credential is missing')
      return {
        headers: { authorization: `Bearer ${current.material}` },
      }
    },
    invalidate: () => {
      void credentialStore.clear()
    },
  },
  webSocketFactory: createReactNativeWebSocketFactory(globalThis.WebSocket),
  handler: async call => executeThroughLocalRuntime(call),
})
```

当前可从首页手工配置连接：

- 用户只输入 Gateway URL 与 API key；URL 会规范化并限制为无 path/query/fragment/userinfo 的 HTTPS
  origin，API key 只接受不含空白的可打印 ASCII token；
- SDK deviceId 默认由设备硬件标识（Android ID / iOS IDFV）加域分隔盐经 SHA-256 派生为 12 位十六进制
  短 ID，跨重装/清数据保持稳定；硬件标识不可用时回退到 SecureStore `installationId` 派生。用户也可在
  同一表单自定义 deviceId（`[A-Za-z0-9._-]{1,64}`，与网关 DO 路由约束一致）。仅供本地归因
  的 keyId 仍为 `manual_api_key_<uuid>`；它们不是网关签发身份或具体 Agent caller；
- 设备在 hello 中声明 `mountPath: device/phone/<deviceId>`；expose node 使用去掉 `phone/` 前缀的相对
  路径，网关下发的相对 call path 在进入本地 executor 前补回前缀，本地 `phone/*` 规范命名空间与
  SQLite 历史格式不变；
- `audienceOrigin`、派生标识和 API key material 一起保存为 SecureStore `DeviceCredentialEnvelope`；API key
  保存后从表单清空，界面不回显；
- 保存顺序为“停止旧 transport -> 写 SecureStore -> 连接新 audience”，写入失败时保持关闭；清除顺序为
  “停止 transport -> 删除 SecureStore key -> 恢复可选构建 URL”，删除失败时不重用未知状态的 key；
- `EXPO_PUBLIC_GATEWAY_ORIGIN` 仍可作为非秘密构建预置，但手工 SecureStore 配置优先；任何 API key、SK、
  token 或私钥都不能进入 `EXPO_PUBLIC_*`；
- 没有 URL 时显示 `unconfigured`；有构建 URL 但无 API key 时显示 `credentials_required`。

现有 SecureStore envelope 是移动仓库的存储结构，不是新的 wire schema。手工 API key 是 pairing
交付前的内测 fallback，不满足设备专用最小权限 credential、签发、rotation、revoke 或短期 ticket。
后续 U-2 pairing 必须使用上游正式响应替代该来源，不能通过 `EXPO_PUBLIC_*`、源码常量、AsyncStorage
或 URL query 注入 secret。

## 3. 能力注册

`CapabilityRegistry.deviceExpose()` 把实际注册的本地 capability 投影成官方 SDK 允许的字段：

```ts
type DeviceNodeCmd = {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  effect?: string
  confirm?: boolean
}
```

- Zod strict input/output schema 通过 Zod 官方 JSON Schema 转换进入 `inputSchema` / `outputSchema`，
  handler 返回值也会先经过 output schema，再进入 JSON/字节上限与持久化边界；
- `effect`、description 和 tool name 来自同一个本地 descriptor；
- 所有非 read、high risk 或本地 `confirmation !== never` 的工具保守投影为 `confirm: true`；这是给
  Agent/gateway 的发现提示，设备上的 Ask every time policy 仍独立生效；
- 静态 hostname allowlist 为空的 `phone/apps` / `phone/media` 能力保留在本机诊断 snapshot；SDK expose
  对相应 path 发送空 command 集合，以覆盖旧 session 的 providerConfig，但不注册注定不可调用的工具；
- `when_locked`、availability、risk、queue policy 与本地 limits 不私塞进未正式化的 wire 字段；
- 本地 policy 始终拥有最终裁决权，gateway/dashboard 的 `confirm` 不能替代设备本地确认。

移动 App 只声明 `nodes`，不声明 `shell` 或 `fs`。

## 4. Call 适配与当前协议缺口

0.11.0 的 `DeviceCallHandler` 当前提供：

```ts
type DeviceCallHandler = (call: {
  id: string
  path: string
  tool: string
  arguments: Record<string, unknown>
  signal: AbortSignal
}) => Promise<unknown> | unknown
```

它没有端到端 caller identity、createdAt 或 expiresAt。为了不绕开已有本地安全执行器，当前适配层：

- 保留 SDK call `id` 作为本地 `commandId`，SQLite 是副作用防重放真源；
- 把已认证 device credential 的非秘密 `keyId` 记录为当前 gateway principal；
- `displayName` 固定为“Tool Bridge 网关”，不伪装成具体 Agent；
- 以本机收到 call 的时间作为 `createdAt`，生成 30 秒本地 commit deadline；
- SDK cancel 的 `AbortSignal` 直接传播给本地 executor。

因此当前 Activity 的 source 只能证明“经哪个 device credential/gateway 信任域到达”，不能证明具体
Agent、用户或上游 SK。真实 caller attribution、gateway deadline 与跨重连时间语义仍需上游扩展正式
call contract；在此之前不能把 `keyId` 描述为 Agent 身份。

本地 `CommandOutcome` 的成功值直接成为 SDK result；失败按 Tool Bridge 规范错误归一为
`invalid_argument | not_found | permission_denied | rate_limited | unavailable | internal`，不会把原生堆栈、
文件路径或 credential 回传。

## 5. 生命周期与可达性

当前只承诺前台实时连接：

| transport state | App reachability | 含义 |
| --- | --- | --- |
| `ready` | `online` | 已收到 gateway ready，可接受低延迟 call |
| `connecting/reconnecting` | `offline` | 尚未 ready，不声称在线 |
| `suspended/closed/error` | `offline` | 生命周期、Disabled 或错误使连接不可达 |
| `credentials_required` | `unconfigured` | gateway 已知，但没有可用 API key/credential |
| `unconfigured` | `unconfigured` | 没有 gateway origin |
| 任意 state + Disabled | `disabled` | 本地策略优先，拒绝新命令 |

后台模型仍是未来的 push + mailbox，而不是维持永久 WebSocket。当前 SDK transport 不实现 U-5 mailbox、
U-6 push registration/dispatch，也不会把 local notification/timer 当成后台命令通道。

## 6. WebSocket 鉴权

0.11.0 官方 RN adapter 支持原生 React Native WebSocket 的非 WHATWG 第三个参数，因此 Android/iOS 原生
环境可以把设备 SK 放在 upgrade `Authorization` header。这个能力不适用于浏览器或 RN Web。

当前 header 方案解除了“原生 RN 无法接入现有 device WS”的 U-1 阻塞，但没有完成 U-2 pairing 或 U-3
短期 ticket：

- 当前内测 secret 是用户手工保存的长期 API key，未来应替换为 pairing 签发的 device credential；
- 重连会重新读取 SecureStore，支持后续 credential rotation；
- secret 不进入 URL、日志、SQLite、审计或 `EXPO_PUBLIC_*`；
- 若未来 gateway 提供短期 ticket，`DeviceCredentialProvider.prepare()` 可以返回专用 header、protocol 或
  URL，而无需改本地 executor。

产品 release 仍优先采用单次、短 TTL、绑定 deviceId/audience/nonce 的 U-3 ticket，并保留当前 header
方式作为原生兼容路径，具体取舍以届时正式上游契约和 threat review 为准。

## 7. SDK 与移动仓库的职责

官方 SDK 负责：

- frame schema、encode/decode 与标准 TBError；
- hello/ready/call/result/ping/pong/cancel；
- 连接、重连、心跳、suspend/resume；
- 进程内 call id 结果缓存。

移动仓库负责：

- SecureStore credential ownership 与 audience 检查；
- AppState、Disabled 与本地撤销 wiring；
- SQLite 持久化幂等和 crash recovery；
- capability probe、policy、权限与本地确认；
- 原生 handler、结果大小、审计与敏感值 redaction。

SDK 的进程内 cache 不能替代 SQLite tombstone；WebSocket 重连也不能成为自动重试副作用的理由。

## 8. 当前验证与升级闸门

当前仓库已有：

- 官方 SDK supervisor 的 fake WebSocket contract：Authorization header、hello/ready/call/result 与
  AppState suspend；
- 手工 URL/API key 的 strict 输入、派生标识、SecureStore 保存/清除顺序、失败保持关闭与 UI secret
  不回显 component test；
- caller/deadline 适配、标准错误映射、缺凭证和 audience mismatch fail-closed 测试；
- registry → DeviceExpose JSON Schema 投影测试；
- `scripts/verify-sdk-device-entry.mjs`：精确版本、package exports 与无 Node `ws/process.env` 泄漏；
- Android 和 iOS production Metro export 成功。

尚未证明：

- 对真实 gateway 的兼容矩阵、弱网/重连和服务器拒绝；
- 手工 API key 对真实 gateway 的认证兼容，以及 pairing、credential issuance/rotation/revoke 端到端；
- gateway caller/deadline attribution；
- iOS/Android 真机前后台连接和长期稳定性；
- mailbox、push 与后台可达。

升级 SDK 时必须继续精确锁版本，并通过 frozen install、入口漂移 gate、unit/contract、双端 Metro、
真实 gateway fixture 和按风险选择的双端原生/真机验证。

本次 consumer 验证命令、结果与未覆盖项见
[2026-08-19 SDK device integration 验证](verification/2026-08-19-sdk-device-integration.md)；手工 URL/API key
配置的专项证据见
[2026-08-19 手工 Gateway 配置验证](verification/2026-08-19-manual-gateway-configuration.md)。
