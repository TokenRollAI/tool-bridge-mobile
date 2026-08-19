# 安全与产品边界

## 不可绕过的不变量

- 系统权限、用户拒绝、设备状态和平台限制高于远程命令；网关许可不能替代设备本地裁决。
- 高风险能力默认拒绝，并声明 effect、risk、confirmation、前后台条件、queue policy 与平台支持。
- 不实现隐藏录音/拍摄、绕过锁屏、后台常驻监控或任意第三方 App UI 自动化。
- capability 必须由实际 probe 得出；不能只按 OS 名称推断，也不能以模拟成功替代 unavailable。
- 副作用前必须完成 runtime schema、过期/取消、probe、policy、所需确认与持久化 claim。
- 用户确认后仍要重新检查过期、取消、probe 和 policy，避免等待期间状态变化造成越权执行。
- SQLite claim 返回后必须最后复检取消/到期；每个本地 capability 的 admission 必须在 confirmation 前
  执行，inline 结果必须在持久化前做 UTF-8 字节上限检查。
- command `complete` 必须把终态 UPDATE 与 retention prune 放在同一 exclusive transaction；10,000 是
  全部终态总 cap，受保护的当前完成项和活动 timer source 仍计入 cap，只是不作为本次删除候选。
- command deadline 必须传给可持续/等待型 handler；emergency disable 必须取消进行中的可中断 handler。
- `Linking.canOpenURL` 也是异步安全边界：必须受调用方取消、command `expiresAt` 和 5 秒本地上限约束，
  并在真正调用 `openURL` 前再次复检取消/到期；probe 成功不能视为永久授权。

## 凭证与敏感数据

- 设备凭证、私钥和 push token 只进入系统安全存储，不进入 SQLite、普通日志、崩溃报告或仓库。
- SDK device credential 的 `audienceOrigin` 必须与当前选中的 HTTPS gateway origin 完全一致；secret 只进
  SecureStore 与 RN WebSocket Authorization header，不进 URL/`EXPO_PUBLIC_*`。缺失、损坏或 gateway
  拒绝都 fail closed。
- 手工 URL/API key fallback 保存时必须先停止旧 transport，再写 SecureStore、连接新 audience；清除时
  必须先停 transport 再删 key。存储结果未知时保持关闭，不得重新使用旧 secret。
- 手工派生的 `mobile_<uuid>` 只是客户端 SDK deviceId，`manual_api_key_<uuid>` 只是 gateway principal；
  两者不能冒充网关签发身份、具体 Agent caller、最小权限、rotation 或 revoke。
- SDK call 未携带具体 caller/deadline 时，只能归因为 gateway credential principal，并生成更短本地
  commit deadline；不得把 credential keyId 冒充 Agent 身份或把本地时间冒充 gateway deadline。
- `installationId` 只是 SecureStore 中的本地安装标识，不是网关签发的 `deviceId`。
- 普通审计只记调用方、能力、决策、结果等元数据；位置坐标、照片、消息正文、完整媒体/跳转 URL
  与 query 不得进入普通审计。
- 清除本地活动历史只能删除 `audit_records`；不得连带删除 command 防重放、timer、设置、installation
  identity 或 credential，也不得取消命令或冒充网关撤销、服务端审计清除和完整数据删除。
- accessibility label/announcement 也是数据出口：不得包含 message、purpose、地址、坐标、URL、完整
  outcome 或 confirmation detail；倒计时和媒体进度不得形成高频自动公告。
- 进入确认页或系统媒体 metadata 的远端显示文本必须拒绝 control 与 bidi override/isolate 字符，
  不允许用文本方向覆盖伪装系统提示。
- 远端 HTTPS 媒体不能直接交给 player：请求必须省略 credentials、手动处理并逐跳复核 redirect，最终
  URL 仍需通过同一 hostname allowlist；声明 MIME、前 16 字节签名、`Content-Length` 与流式实际字节
  都必须在进入 player 前通过本地边界。
- 媒体下载只落入 App 私有 cache，当前单源硬上限 25 MiB、本地解析时限 30 秒；失败、取消、停止和
  player 启动失败必须释放缓存，player 只接收解析后的 `file://` URI。
- 媒体 metadata 最多等待 10 秒；直播、无效时长和超过 2 小时的来源必须在原生 `play()` 前拒绝。
- 大对象必须使用上游受保护的 `objectRef` 流程；在该契约交付前不得用公开 URL 或 base64 冒充。

## 平台权限

- 当前位置只使用逐次确认后的前台权限与一次性采集，不声明后台/Always/location foreground service。
- 媒体只允许 App 自有、系统可见的播放会话；未声明录音权限。
- attention 的 haptic 与固定本地 find-device sound 必须分别 probe、分别停止；sound 只使用 App 私有 cache
  中生成的有限 PCM，不接收远端音频、不请求录音权限、不绕过静音/DND。闪光和后台物理效果不能虚报。
- App handoff 只处理配置 allowlist 内的 HTTPS URL，并只返回 `handed_off`，不声称第三方动作完成。
- 地图 handoff 只接收 strict coordinate/query，由本地按平台生成 Android `geo:` 或 Apple Maps HTTPS；
  caller 不能提供 URL、scheme 或 provider，返回值与普通审计不能回显 coordinate/query。
- 远程 `notify` 不得请求系统通知权限；未决定/可再次请求、永久拒绝和 channel disabled 必须投影为不同
  availability，由用户在本地 UI 请求权限或进入系统设置。
- 本地通知不能继承任意 title/action/data/sound/badge：系统 title、正文前缀、Android channel 和
  `commandId` 派生 identifier 固定；返回 `scheduled` 只表示系统接受本地调度，不等于 presented/clicked。
- local-only 通知构建不能保留 APNs entitlement、FCM/C2DM、boot/exact alarm、厂商 badge 或 Firebase
  transport 注册入口；新增 Expo Notifications 版本时必须复核最终 merged manifest/entitlements。
- 远程 timer start 只接受 canonical UTC `firesAt` 与 `purpose`，并在 reserve 和 native schedule 前都复核
  10 秒至 24 小时窗口；`purpose` 只可进入本地确认，不得写入 SQLite、原生通知、outcome 或普通 audit。
- timer 使用绝对 DATE local notification 只是系统 best-effort 接受：任何结果都不得声称 fired、delivered、
  presented、clicked 或 on-time；不得为它增加 boot receiver、exact alarm、FCM 或 APNs。
- timer 的 SQLite 意图与 caller ownership 高于原生 pending 快照。启动恢复必须先恢复中断 command，再
  reconcile timer，最后 prune command；emergency disable 必须用撤销 epoch 隔离迟到的 native schedule。

## 事实真源

- 安全要求与平台依据：`docs/SECURITY.md`
- 能力契约和支持矩阵：`docs/CAPABILITIES.md`
- 执行不变量：`src/runtime/localCommandExecutor.ts`、`src/policy/policyEngine.ts`
- SDK transport 边界：`llmdoc/reference/sdk-device-transport.md`、`docs/SDK.md`
