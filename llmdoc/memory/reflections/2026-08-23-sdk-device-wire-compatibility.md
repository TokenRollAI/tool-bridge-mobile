# SDK device wire 兼容升级反思

## 任务与根因

本次把移动端从 `@tool-bridge/sdk@0.11.0` 升级到 `0.14.1`，修复已建立并保持心跳的 Android
设备无法处理当前 Gateway device call 的问题。旧 SDK 期待 `path` 与 `tool` 分列；Gateway 已改为把
命令叶子并入完整 `path`。因此新版合法 call 在 0.11.0 codec 处被判为非法，触发
`onProtocolError` 后按 SDK 约定忽略，没有进入本地 executor，也不会返回 result；Gateway 最终只能在
60 秒等待结束后投影为 `unavailable`。

最有迷惑性的现场信号是 WebSocket、ready 和心跳仍然正常。App 同时显示 `online`、`active` 与
`protocol_error` 并不矛盾：前两者说明连接和生命周期仍在工作，后者说明某个应用协议帧无法解码。
因此 `ready/online` 只能证明会话握手完成，不能证明 call frame、cancel 或 result 的当前 wire 版本兼容。

## 有效迁移方式

- 先以 0.14.1 正式 `/device` 类型、发布产物和上游实现为事实真源，而不是在移动端补一个兼容旧
  `call.tool` 的私有 frame 分支。`DeviceCallHandler` 的实际边界是
  `id/path/arguments/signal/context?`。
- 把 wire 归一化压缩成一个可独立测试的解析函数：只按最后一个 `/` 拆分 node path 和 command leaf，
  从而同时覆盖 `status/get` 与多层 `runtime/commands/list`。没有 owner、没有 command、空段或尾随
  斜杠都在进入 executor 前返回 `invalid_argument`。
- context 存在时，caller 稳定主体使用网关签发的 `caller.keyId`，`createdAt` 使用网关值，
  `expiresAt` 取网关期限与本地接收后 30 秒上限的较早值。`arguments` 仍只是 capability 参数，不能覆盖
  caller、context 或 deadline。
- context 缺失时保留明确降级：使用 credential principal 与本地接收时间/30 秒上限。该路径只表示
  调用来自对应 Gateway 信任域，不能冒充具体 Agent 身份或网关权威时钟。
- 迁移只改变 transport 到 `LocalCommandExecutor` 的映射；command id、AbortSignal、SQLite 去重、probe、
  policy、确认、结果上限与审计边界继续沿用原执行链。fake supervisor 回归还应覆盖合法 call 不再污染
  snapshot、重复 id cache 和 cancel，避免只测试路径字符串。

## 验证分层经验

这类问题需要把验证分成互不替代的层级：

1. 依赖层核对精确版本、`/device` export、产物静态 import 闭包、lock integrity 与 release-age 精确例外；
2. consumer 层用正式 SDK supervisor 加 fake raw WebSocket 覆盖新 frame、context、result、cancel、错误映射
   与防重放语义；
3. bundler/build 层分别验证 Android Preview APK 与 iOS production Metro/Hermes export；
4. 安装层核对 Preview package、内嵌 production bundle、签名与覆盖安装数据保留；
5. 现场层冷启动后同时观察 device identity、online/active、`protocol_error`，最后经真实 Gateway 只做一次
   有界、只读的 `status/get`。

本次 frozen install 与全量 `pnpm verify` 通过；全量结果为 64 suites / 294 tests，typecheck、lint 全绿。
Jest 报告 open-handle 提示但退出码为 0，应如实保留为提示，不能改写成“完全无告警”。Android Preview
clean build 成功，产出 0.0.6（build 6）的 Preview APK，包含 production JS bundle 且 v2 签名有效。
覆盖安装前核对新旧 signer digest 一致，`adb install -r` 成功且首次安装时间未变化；冷启动保留原
deviceId，状态为 `online/active`，调用前后均未再出现 `protocol_error`。

按 Tool Bridge live help 和 feedback 流程后，仅执行一次真实 `status/get`，返回值符合 live schema，
包括 Android、active、online、direct-call 以及可用的电池/网络投影，没有用重复调用掩盖偶发失败。
该证据只支持“0.14.1 新版直连 device wire 与当前 Gateway 的 `status/get` 路径已完成 Android 真机兼容
验证”，不外推到全部能力、iOS 原生构建/真机、后台、弱网、长期连接或完整 pairing。

## Expo 依赖漂移的处理

首次 `pnpm verify` 的 config、SDK、secret、license 等前置门禁已通过，但 `expo install --check` 根据
SDK 57 当前 `bundledNativeModules` 要求报告 11 个 Expo 包各落后一个 patch。若只为了保持“SDK 单依赖
升级”的表面小 diff 而忽略这项失败，最终结论就不能称为 verify 全绿。

有效处理是明确记录范围扩张的原因，精确升级 Expo 57.0.15 及门禁点名的配套 patch，更新受版本约束的
原生模块 gate，再重新生成 lock、执行 frozen install、全量 verify、双端 bundle 与 Android clean build。
这类自动检查触发的依赖漂移应在 diff 和汇报中单独说明；既不能隐瞒成 0.14.1 的传递变化，也不能在
未验证时把它描述为与本任务无关的噪声。

## 可提升的稳定经验

- realtime 健康度应拆成 transport/session 健康与 frame compatibility；心跳成功绝不能替代最小真实 call
  round trip。
- SDK 升级 gate 除 export 与 Metro 闭包外，应保留一个与当前正式 call fixture 同形的 consumer contract，
  并把 `onProtocolError` 视为需要现场关联的应用协议信号。
- 真机兼容测试优先选择单次、无副作用、schema 可严格检查的读命令；验证成功后停止，不把重试次数当
  可靠性证据。
- 依赖一致性门禁造成的额外 patch 升级必须作为独立变更事实记录，并从 frozen install 开始重跑验证链。
