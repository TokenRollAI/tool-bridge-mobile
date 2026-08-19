# SDK device transport 参考

## 已发布事实

- 移动端精确依赖 `@tool-bridge/sdk@0.11.0`，生产代码只从 `@tool-bridge/sdk/device` 导入。
- `/device` 导出 `connectDevice`、`createReactNativeWebSocketFactory`、DeviceExpose/frame/TBError 类型与
  codec；包根仍是 Node 入口。
- package `engines.node >=22` 由仓库 Node 22.23.1 构建环境满足，不代表手机运行 Node。
- 当前 `dist/device.js` 只有 `partysocket/ws` 外部 import，不导入 Node `ws` 或 `process.env`；
  `scripts/verify-sdk-device-entry.mjs` 是升级漂移 gate。

## 移动 wiring

`src/gateway/sdkDeviceTransport.ts` 负责：

- 从 SecureStore 读取 `DeviceCredentialEnvelope`，要求 `audienceOrigin === EXPO_PUBLIC_GATEWAY_ORIGIN`；
- 使用 RN WebSocket 第三个参数注入 Authorization，secret 不进 URL；
- 用本地 registry 生成官方 `DeviceExpose.nodes[].cmds[]`，不复制/扩展 frame；
- active + enabled 时连接/resume，background/inactive/Disabled 时 suspend；
- 只有 SDK `ready` 映射为 `reachability: online`；
- gateway rejection 后清 credential，缺 credential 和 audience mismatch fail closed；
- call 进入既有 `LocalCommandExecutor`，继续受 SQLite 去重、probe、policy、确认、结果上限与审计约束。

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
- `credentials_required`：有 origin，无配对凭证。
- `connecting/reconnecting/suspended/closed/error`：不声称 online。
- `ready`：只证明前台 SDK session ready。
- `disabled` reachability 始终覆盖 transport state。

U-1 已由该子入口交付并被消费。仍未完成：U-2 pairing/credential issuance、U-3 短期 ticket、真实
gateway compatibility、caller/deadline、U-4 动态 profile、U-5 mailbox、U-6 push 和 U-7 objectRef。

## 证据边界

已有 consumer 证据：真实 SDK supervisor + fake WebSocket contract、registry expose、错误映射、凭证
fail-closed、双端 production Metro export、全量 `pnpm verify`。

这些不证明真实 gateway、真机 header、弱网/重连、前后台 OS 行为、credential revoke、mailbox 或 push。
升级版本时必须重跑 frozen install、SDK entry gate、consumer contract、双端 Metro 与真实 gateway matrix。
