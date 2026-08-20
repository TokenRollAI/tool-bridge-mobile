# 本地能力切片

## 共同模式

每个能力拥有 descriptor、strict input/output schema、preflight/probe、handler、稳定错误映射和可注入
adapter。registry 在展示与执行前读取真实 probe，并在返回 SDK 前解析 handler output；平台模块不可自行
持有 gateway credential。依赖静态 allowlist 且配置为空的能力不公开 command，但仍发送对应空 node 来
覆盖旧注册；真实网关是否正确移除旧命令需单独验证。

## Android 原生控制面现状

- 仓库自有 Android Expo native module 当前是 `modules/tool-bridge-attention` 的 haptic probe/执行与
  torch 闪光灯 probe/enable/disable（走 `CameraManager`，不需 Camera 权限）；其余已实现能力通过受限
  Expo API、App 内状态机或系统 handoff 提供。
- 当前没有 AccessibilityService、MediaProjection、notification-listener 或 DevicePolicyManager/device-owner
  控制实现，也没有对应 service/config；因此不能跨 App 操作任意 UI、捕获屏幕或管理专用设备。
- 当前原生权限面仍按已实现切片最小化：未声明相机、麦克风或后台位置权限。Android 更高权限控制路线尚未
  决定，也未实现，不能从现有 capability 或构建配置推断其可用。

## 当前实现

### `phone/status.get`

- 从 Expo Battery、Network 与 AppState 读取可得状态；缺失字段返回结构化 unavailable，不填造数据。
- 低风险、只读、无需确认；通过 SDK registry expose 与 output schema 暴露。

### `phone/attention.ring|stop`

- 自定义 Expo 模块在 Android 使用 `Vibrator.hasVibrator`，iOS 使用 Core Haptics capability probe；
  Android API 24–25 走兼容 `Vibrator.vibrate(long)`，API 26+ 使用 `VibrationEffect`。
- controller 提供 TTL、取消、单活动会话、调用方/全局 rate limit 和 UI stop；声音与 haptic 独立 probe、
  独立启动并在 stop/到期时共同释放。
- `find_device` sound 是固定参数生成的短 PCM WAV，只进入 App 私有 cache 后交给 `expo-audio`，不读取远端
  音频、不请求录音权限，也不设置静音模式播放。
- flash 通过系统 torch API 实现（Android `CameraManager.setTorchMode`、iOS `AVCaptureDevice.torchMode`），
  独立 probe/enable/disable，与 sound、haptic 一样纳入会话 TTL/取消/停止的共同释放；只在探测到闪光灯
  硬件时点亮，不声明 Camera 权限、不打开采集流，torch 被占用或系统拒绝时返回 `flash_unavailable`。
- DND/静音、后台/锁屏、真实音频与闪光物理输出（含 torch 被其他 App 抢占）待双端真机证据。

### `phone/media.play|pause|resume|seek|stop|status`

- `expo-audio` 单 player controller；远端 source 先由 bounded resolver 解析，不把 HTTPS URL 直接交给
  player。resolver 使用 `expo/fetch` 的 `credentials: omit` 和 `redirect: manual`，每一跳与最终响应 URL
  都复用 HTTPS hostname allowlist。
- resolver 只接受音频 MIME allowlist，并以最多 16 字节 magic signature 复核内容；`Content-Length`
  与流式实际字节都受 25 MiB 硬上限约束，下载另有 30 秒本地 timeout 并传播 `AbortSignal`。
- 通过校验的字节写入 `expo-file-system` App 私有 cache，player 只接收 `file://` URI。失败、取消、
  player 启动失败和 stop 均进入对应 cache 清理路径；cache store 初始化时也清理此前遗留项。
- 原生 port 最多等待 10 秒取得 metadata；直播、无效时长和超过 2 小时的媒体在 `play()` 前被拒绝。
- `seek` 只接受当前 session id 与 0..7,200,000ms 的位置；未知 duration 或目标超过当前 duration 时拒绝，
  不猜测直播/无 metadata 会话的可跳转性。
- App session 与普通审计只保留 hostname、MIME 与大小等安全摘要，不保存完整 URL/query；系统 metadata
  带 Tool Bridge/调用方标识。
- 已生成 Android media playback foreground service 与 iOS audio background mode 配置，但锁屏控制、
  后台播放和音频中断未做双端真机验收；上游 `objectRef` 与其下载授权仍未实现。

详细解析顺序、MIME 列表和清理所有权见 `llmdoc/reference/bounded-media-source.md`。

### `phone/apps.can_open_url|open_url`

- 只接受配置 hostname allowlist 内的 HTTPS URL；安全预检发生在确认和 `Linking.openURL` 前。
- `canOpenURL` 通过共享 bounded probe 执行，同时服从 `AbortSignal`、command `expiresAt` 与 5 秒本地
  timeout；`open_url` 在 probe 返回后、真正 `openURL` 前再次复检取消/到期，避免等待期间越过执行边界。
- `open_url` 仅前台执行并返回 `handed_off` 与脱敏 hostname，不声称第三方 App 内动作成功。

### `phone/location.current`

- high risk、always confirmation、foreground only；确认前不请求权限或开始采集。
- 使用 `expo-location` foreground probe，区分 available、permission_required 与 unavailable。
- 单次可取消 `watchPositionAsync` 在首个 fix/取消/超时后移除；拒绝超过 30 秒或未来偏差超过 5 秒的 fix。
- 返回采集时间、水平精度、precise/approximate/unknown 与 mocked；普通审计不保存坐标。
- 原生配置不声明后台/Always/location foreground service/motion；真机权限对话框、精度和服务撤销未验收。

### `phone/location.open_map`

- 只接受 strict 结构化 `coordinate` 或 `query` 及 purpose，不接受 caller URL、scheme 或 provider；本地
  builder 在 Android 生成 `geo:`，在 iOS 生成 Apple Maps HTTPS link。
- medium risk、always confirmation、foreground only。动态 probe 不只看平台/Linking module，还用本地
  生成的安全目标实际执行 bounded `canOpenURL`，没有 handler 时投影为 unavailable。
- handler 的 `canOpenURL` 受 `AbortSignal`、command `expiresAt` 和 5 秒本地 timeout 约束，返回后在
  `openURL` commit 前再次检查取消/到期。
- 成功只表示系统接受 handoff；result 只含 `handed_off` 与 `android_geo_handler | apple_map_link` provider，
  普通 audit 不保存或回显 coordinate/query，不能声称地图 App 已显示或完成导航。

完整输入、执行与证据边界见 `llmdoc/reference/bounded-linking-handoffs.md`。

### `phone/productivity.notify`

- 使用 `expo-notifications 57.0.12` 调度即时 local notification，不注册 push token，也不实现 remote
  notification。strict schema 只接受 trim 后非空的 purpose（最多 120）和 message（最多 240），拒绝
  control/bidi 字符及 title、data、action、scheduleAt 等未知字段。
- 系统内容固定为 title `Tool Bridge` 和正文前缀 `Agent 通知：`；Android 固定 channel
  `tool_bridge_local_requests_v1`，不发声、不震动、不亮灯、不 badge、不绕过 DND。identifier 为
  `tb_local_notify_` + `SHA-256(commandId)`，用于限定本 capability 的本地通知。
- capability foreground only；远程 handler 只读取授权并在 commit 前复检取消/到期，永不调用权限请求。
  fresh Android 的 `denied + canAskAgain=true` 映射 requestable；不可再请求映射 denied/settings；授权后
  channel importance 为 NONE 则映射 channel disabled/settings。
- 成功 result 只报告确定性 notification id、`status: scheduled`、`presentation: system_determined` 与本地
  scheduledAt。它不声称通知已呈现、送达或点击，普通 audit/command outcome 不保存 purpose/message。
- final Expo config 移除 APNs `aps-environment`；Android blocked permissions 移除 boot/exact、C2DM 与厂商
  badge，custom plugin 移除 FCM/Firebase service/receiver/provider 和 transport scheduler，只保留不可导出
  的本地 event receiver 与 forwarder。该切片不满足 U-5 mailbox 或 U-6 push。

详细权限映射、native 内容与最终配置边界见 `llmdoc/reference/local-only-notifications.md`。

### `phone/productivity.timer_start|timer_cancel|timer_status`

- `timer_start` 只接受 canonical UTC 毫秒 `firesAt` 与 confirmation-only `purpose`；reserve 与 native commit
  前都要求剩余时间在 10 秒至 24 小时内。`timer_cancel` / `timer_status` 只接受确定性 `timerId`。
- SQLite schema v2 保存 `preparing | scheduled | cancelling | cancelled | deadline_elapsed | status_unknown`，
  用 exclusive transaction 原子限制每 caller 8 个、全局 32 个活动 timer；远程 cancel/status 只能读取
  caller 自己的 timer，本地 UI 可独立取消。
- `timer_` 与 `tb_local_timer_` id 都从 `SHA-256(commandId)` 确定性派生；原生内容固定为
  `Tool Bridge / Agent 计时器已到期`，绝不包含 purpose。调度使用绝对 DATE local notification，属于系统
  best-effort，不使用 boot receiver、exact alarm、FCM 或 APNs。
- 启动时先恢复 command，再在 command prune 前 reconcile：来源 command 已成功、仍在未来、状态为
  `scheduled` 且原生 pending 缺失时才同 id rearm；中断/未知 command 的 crash orphan 只清理、不重放。
- native Promise 迟到、schedule CAS 失败、cancel 结果未知和 emergency disable 均有补偿清理；撤销 epoch
  阻止停用前发起的异步 schedule 在停用后提交。持久化 `status_unknown` 明确保留未知，而不猜测成功。
- start 只报告 `system_accepted` / `system_determined`；status 可投影 `schedule_missing`，但所有结果都不声称
  fired、delivered、presented、clicked 或 on-time。purpose 不进入 DB、native、outcome 或普通 audit。

完整状态转换、恢复条件和证据边界见 `llmdoc/reference/local-timers.md`。

### `phone/runtime.capabilities|pending_commands|cancel`

- `capabilities` 返回 registry 当前 descriptor 与 live availability，明确区分“本地实现”与“此刻可用”。
- `pending_commands` 只返回同 gateway credential principal 的安全活动元数据，不返回 arguments；当前查询
  command 自身不出现在列表中，等待本地确认的命令标记为 `awaiting_user`。
- `cancel` 只向同 principal、当前进程内的活动命令请求 AbortSignal 取消；它是 write effect，因此 SDK
  expose 仍标记 confirm，不声称等价于具体 Agent identity、网关 mailbox 或跨进程撤销。

## 配置来源

- media hostname：`EXPO_PUBLIC_MEDIA_HOSTS`
- App handoff hostname：`EXPO_PUBLIC_LINK_HOSTS`
- map target：本地结构化 schema + platform builder，不读取 hostname allowlist，也不接受 caller URI
- 变量解析与 Expo 原生配置：`app.config.ts`
- capability 装配：`src/runtime/applicationRuntime.ts`
- local-only notification final config：`app.config.ts` + `plugins/withLocalOnlyNotifications.cjs`
- local timer persistence：`src/storage/migrations/0002_timers.ts` + `src/storage/timerRepository.ts`

## 证据上限

unit/component/local contract 证明的是本地边界。registry 将单项 probe 异常隔离为
`unavailable: probe_failed`。Android clean debug build 证明原生依赖与配置能编译；
两者都不证明 production gateway、iOS build 或真机前台/后台/锁屏行为。
