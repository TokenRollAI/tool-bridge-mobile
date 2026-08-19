# SDK device transport 参考

## 已发布事实

- 移动端精确依赖 `@tool-bridge/sdk@0.11.0`，生产代码只从 `@tool-bridge/sdk/device` 导入。
- `/device` 导出 `connectDevice`、`createReactNativeWebSocketFactory`、DeviceExpose/frame/TBError 类型与
  codec；包根仍是 Node 入口。
- package `engines.node >=22` 由仓库 Node 22.23.1 构建环境满足，不代表手机运行 Node。
- 当前 `dist/device.js` 只有 `partysocket/ws` 外部 import，不导入 Node `ws` 或 `process.env`；
  `scripts/verify-sdk-device-entry.mjs` 是升级漂移 gate。
- React Native 目标运行时缺失浏览器完整 `MessageEvent` 与 `AbortSignal.throwIfAborted()`；App 入口在加载
  router/SDK 前只补齐缺失成员，避免 ready 后的 message/cancel 路径因运行时差异抛出 `internal`。

## 移动 wiring

`src/gateway/sdkDeviceTransport.ts` 负责：

- 启动时优先从 SecureStore credential 选择 audience；没有手工 credential 时才使用可选的非秘密
  `EXPO_PUBLIC_GATEWAY_ORIGIN` build preset；
- 每次建连从 SecureStore 读取 `DeviceCredentialEnvelope`，并要求 credential audience 与当前连接 origin
  完全一致；
- 使用 RN WebSocket 第三个参数注入 Authorization，secret 不进 URL；
- 用本地 registry 生成官方 `DeviceExpose.nodes[].cmds[]`，每个 command 同时包含 input/output schema；
  静态不可配置的 path 仍以空 `cmds` node 发送来尝试覆盖旧注册，不复制/扩展 frame；
- active + enabled 时连接/resume，background/inactive/Disabled 时 suspend；
- 只有 SDK `ready` 映射为 `reachability: online`；
- 在交给 SDK 的 raw WebSocket factory 外采集脱敏失败分类、阶段与 close code，不复制 SDK 协议状态机；
- gateway rejection 后清 credential，缺 credential 和 audience mismatch fail closed；
- call 进入既有 `LocalCommandExecutor`，继续受 SQLite 去重、probe、policy、确认、结果上限与审计约束。

首页现已提供手工 HTTPS origin + API key 内测入口。它经
`ManualGatewayConfigurationController` 按“停止旧连接 -> 写/清 SecureStore -> 应用新 origin”切换，失败时
保持断开。输入、身份、存储与证据边界见 `llmdoc/reference/manual-gateway-configuration.md`。

## Call 归一化

0.11.0 call 只有 `id/path/tool/arguments/signal`。当前 adapter：

- 保留 `id` 为 `commandId`；
- 用 device credential 的非秘密 `keyId` 作为 gateway principal，固定 display name；
- 用本地接收时间作为 createdAt，并生成 30 秒本地 commit deadline；
- 传播 SDK AbortSignal；
- 成功只返回本地 outcome value，失败归一为 SDK 规范 TBError。

`keyId` 不是具体 Agent caller。上游补 caller/deadline 前，不得把 Activity source 或本地限流描述为具体
Agent 归因；同一 credential 下的调用共享 caller bucket 和 timer ownership。

## 状态和未完成项

- `unconfigured`：没有 gateway origin。
- `credentials_required`：有 origin，但 SecureStore 中没有可用 API key/credential。
- `connecting/reconnecting/suspended/closed/error`：不声称 online。
- `ready`：只证明前台 SDK session ready。
- `disabled` reachability 始终覆盖 transport state。

## Raw WebSocket 诊断边界

`DeviceTransportDiagnostic` 只允许三个固定字段：

- `kind`：`connection_timeout`、`dns_resolution_failed`、`tls_failed`、`upgrade_rejected`、
  `network_unreachable`、`connection_reset`、`connection_refused`、`abnormal_close` 或 `unknown`；
- `stage`：`socket_opening`、`gateway_handshake` 或 `session`；
- `closeCode`：只接受 WebSocket 1000..4999 的有限整数，否则为 `null`。

RN/OkHttp 的 raw close `reason` 最多只在当前调用栈内参与固定分类，随后丢弃。它不能进入 snapshot、日志、
审计、accessibility announcement 或 UI；URL、query、Authorization、credential 和 deviceId 也不是 diagnostic
字段。该分类只用于现场排障，不能参与鉴权或安全裁决。

observer 用 logical connection revision 与 raw attempt ordinal 拒绝旧 socket 的迟到事件。本地主动
suspend、配置切换、local revoke 和 credential invalidation 在调用 SDK 前 suppress/retire 当前 attempt；
不信任远端可伪造的 close reason 来判断“主动关闭”。重连期间保留最近失败，SDK `ready`、新配置、
`unconfigured` 与 `credentials_required` 清除旧诊断。

U-1 已由该子入口交付并被消费。手工 URL/API key fallback 不完成 U-2 或 U-3。仍未完成：U-2
pairing/credential issuance、U-3 短期 ticket、真实
gateway compatibility、caller/deadline、U-4 动态 profile、U-5 mailbox、U-6 push 和 U-7 objectRef。

## 证据边界

已有 consumer 证据：真实 SDK supervisor + fake WebSocket contract、双向 schema registry expose、错误映射、凭证
fail-closed、手工配置事件顺序、raw close 脱敏/旧连接隔离与 secret 不回显、双端 production Metro
export、全量 `pnpm verify`。

这些不证明真实 gateway 对空 command node 的删除语义、真机 header/diagnostic、弱网/重连、前后台 OS
行为、credential revoke、mailbox 或 push。诊断 UI 出现固定分类也不等于对应根因已经由真机日志或
服务端日志确认。
升级版本时必须重跑 frozen install、SDK entry gate、consumer contract、双端 Metro 与真实 gateway matrix。
