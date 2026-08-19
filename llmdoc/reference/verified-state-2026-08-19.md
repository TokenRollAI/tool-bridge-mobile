# 2026-08-19 已验证状态

## 范围

这是当前未提交工作树的时间点快照，供后续任务快速判断“已有证据”和“仍需重验”。代码继续变化后，
必须重新运行验证并更新或新增快照，不能永久沿用数字或 artifact digest。

## 本地已实现并有自动化覆盖

- Expo Router development-build 双端脚手架与 development/preview/production 三套隔离标识。
- SecureStore `installationId` 与 opaque device credential facade；SQLite control mode、command、audit schema。
- strict command/capability/result schema、过期/取消、动态 probe、policy、本地确认、持久化/并发
  `commandId` 去重、crash recovery、有界保留和脱敏审计。
- confirmation 前 caller/global admission、inline 结果字节上限、claim 后取消/到期复检，以及 attention /
  location command deadline 传播。
- emergency disable 取消进行中 handler、阻止新 handler、拒绝 pending confirmation，并停止
  attention/media session 与活动 timer。
- status、haptic attention、allowlisted HTTPS App handoff、一次性前台 location、结构化 `open_map` 与
  local-only `phone/productivity.notify`、App 内 `timer_start|timer_cancel|timer_status` 本地纵向切片。
- Activity 最近 100 条脱敏调用投影、audit 写时 5,000 条硬上限、设备本地 destructive confirmation 与
  只删除 `audit_records` 的历史清除；command 防重放及其他本地状态不受 clear 影响。
- command complete 写终态与 retention prune 同 SQLite exclusive transaction；终态总 cap 为 10,000，
  running、当前完成项和活动 timer source 不作为删除候选，但 protected 终态仍计入 cap。
- shared UI accessibility semantics 覆盖 header、关联 StatusRow、唯一 action/tab label、busy/disabled、48dp、
  focus/announcement 去重、敏感/高频内容不公告与 contrast regression gate。
- frozen install、peer、secret、license 与 high-severity dependency policy gate 通过；audit 仍报告
  1 个 moderate，另有 2 个已由仓库补丁和恶意样本回归覆盖后定向豁免的 `image-size` high。

## 本轮实现与全量基线

- `@tool-bridge/sdk@0.11.0` 已精确锁定并只通过 `/device` 子入口进入移动生产代码；
  `SdkDeviceTransport` 使用 SecureStore credential + audience check、RN Authorization header、官方
  hello/ready/call/result/heartbeat/cancel/reconnect 与 AppState suspend/resume，并把 call 交给已有本地
  executor。只有 ready 为 online；缺 origin/credential 和错误均 fail closed。
- SDK call 缺具体 caller/deadline；当前明确以 credential keyId 作为 gateway principal，并从本地接收时间
  生成 30 秒 deadline，不冒充 Agent attribution。U-2 至 U-7 与真实 gateway matrix 仍未完成。

- 媒体 source resolver 已实现 omit credentials、逐跳/最终 URL allowlist、MIME + magic signature、
  25 MiB 声明/实际字节上限、30 秒 timeout/取消、App 私有 cache 与 `file://` player 隔离；原生 port
  另在 `play()` 前执行 10 秒 metadata timeout 与 2 小时时长上限。
- `open_map` 已实现 strict coordinate/query、本地 Android `geo:` / Apple Maps HTTPS builder、always
  confirmation、前台/实际 handler probe、bounded `canOpenURL`、commit 前复检及脱敏 result/audit；
  通用 `phone/apps` handoff 同步采用同一 bounded Linking 边界。
- `phone/productivity.notify` 已实现 `expo-notifications 57.0.12` local-only adapter、strict purpose/message、
  固定 title/prefix/channel、确定性 id、动态授权/channel probe、远程不请求权限及只报告 scheduled 的结果。
  final config 已收敛 APNs/FCM/C2DM/badge/boot/exact/Firebase transport 入口。
- timer 已实现 canonical UTC firesAt + confirmation-only purpose、10 秒至 24 小时重复时间复核、SQLite v2
  状态机与 8/caller、32/global 容量、确定性 timer/native id、caller ownership、本地 UI cancel，以及
  command recover 后/prune 前 reconciliation。只对已成功的未来 missing schedule 同 id rearm；crash orphan、
  迟到 Promise、CAS/cancel unknown 与 emergency epoch 均走保守清理或 `status_unknown`。
- Activity history 已实现 caller/time/capability/effect/risk/decision/outcome 投影、写时原子 retention、
  clear 失败诚实、DELETE 后新 audit 保留与 revision 防旧 refresh 回写。contract 证明副作用执行一次后
  clear audit，再 replay 同一 commandId 时 handler 仍只有一次，新 audit 为 `decision: replayed`。
- command retention 已用 repository/retention tests 与 host sqlite3 fixture 验证：每次 complete 同 transaction
  写终态/裁剪，删除 oldest eligible，保留 running/current/active timer source；总终态为 10,000 而不是
  `10,000 + protected`。Memory repository 维持等价 hard cap。
- accessibility baseline 已用 shared component、navigation、announcement 与 contrast tests 覆盖，并通过
  API 36 语义树/200% 系统字号 smoke；该 smoke 没有开启 TalkBack。
- 使用锁定的 Node 22.23.1 与 pnpm 11.21.0 对当前工作树执行最终 `pnpm verify`：docs/config/native
  module/SDK entry/secret/license/dependency mitigation/Expo 版本、strict typecheck、零 warning lint全部
  通过，Jest 为 49 suites / 200 tests；Android/iOS production Metro 分别 bundle 1,527 / 1,396 modules。
- 随后已重新完成 Android clean build 与 emulator smoke；debug APK 不内嵌 Metro JS，clean build 证明
  当前原生依赖/配置可编译，smoke 证明最新开发 bundle 能启动，但不构成实际地图或媒体 handoff 证据。

## Android clean debug build

- 已用 Node 22.23.1、pnpm 11.21.0、Java 17.0.20+8、Android SDK 36 从 clean Expo prebuild 构建成功。
- Expo autolinking 明确列出 `expo-file-system 57.0.4` 与 `expo-notifications 57.0.12`。
- 结果：`BUILD SUCCESSFUL in 1m 11s`，696 个 Gradle tasks 中 664 个执行、32 个 up-to-date；APK 为
  263,308,621 bytes，SHA-256 与此前基线相同：
  `ae9f5a8253bff6427fe4b3c026ccf7439d74df35277c43b128c4b32b1b983d06`。
- merged manifest 含 media playback foreground service 与 coarse/fine foreground location；不含
  `RECORD_AUDIO`、`ACCESS_BACKGROUND_LOCATION`、`FOREGROUND_SERVICE_LOCATION`、legacy storage、
  biometric 或 development overlay 权限。
- `open_map` 只新增 package visibility 的 `VIEW` + `geo:` query，没有新增位置、后台或其他系统权限。
- local-only notification 最终包声明 `POST_NOTIFICATIONS`，仅保留不可导出的 local
  `NotificationsService`（唯一 action 为 `expo.modules.notifications.NOTIFICATION_EVENT`）与
  `NotificationForwarderActivity`；不含 boot/exact、C2DM、厂商 badge 权限，亦无 Expo/Firebase messaging
  service/receiver/provider 或 Firebase transport scheduler。
- timer 复用同一 local-only notification 边界；clean build 没有为 timer 增加 boot receiver、exact alarm、
  FCM、APNs 或其他远程 transport 入口。
- 完整命令、环境和限制以 `docs/verification/2026-08-19-android-debug.md` 为事实真源。

## Android preview APK

- `pnpm build:android:preview` 以 `APP_VARIANT=preview`、`NODE_ENV=production` clean prebuild 后执行
  `assembleRelease`；`BUILD SUCCESSFUL in 6m 5s`，903 tasks 中 871 executed、32 up-to-date。
- Metro 将 1,523 个 module 写入 `assets/index.android.bundle`。APK 为 109,966,791 bytes，SHA-256
  `84e8a6e7db045cbe466d3787b638426e329d7279f495e011427516cdb2584b53`，package 为
  `ai.tokenroll.toolbridgemobile.preview`。
- APK 使用 Expo prebuild 生成的 Android debug test key 与 v2 签名，只是可安装的内部体验包，不是
  production signer 或 Play release。
- API 36 emulator 上显式冷启动 preview MainActivity 成功，内嵌 bundle 进入本地运行时首页并显示
  transport `unconfigured` 与四个 tab；启动窗口没有 preview `FATAL EXCEPTION`。
- workflow 已声明在 verify 后构建同一 preview APK、生成 SHA-256 并上传 14 天 artifact；远端 Actions
  尚未产生本提交的成功 run，因此 CI artifact 仍待远端证据。
- 完整命令和限制以 `docs/verification/2026-08-19-android-preview-apk.md` 为事实真源。

## Android emulator smoke

- API 36 / Android 16 arm64 emulator 上的仓库脚本从卸载 dev 包开始，重装上述 APK 并通过
  `dumpsys package` 复核版本、min/target SDK、必须权限和禁止权限。
- 自动化完成 development client 启动、首页状态、动态 capability/未授权位置降级、紧急停用以及
  force-stop 后持久化恢复，并确认能力页出现 `phone/location.open_map`、smoke 期间无 App fatal
  exception。
- smoke 没有实际触发 `open_map` 或第三方 App handoff；能力可见不等于 `geo:` handler 已在 emulator
  打开，也不构成导航行为证据。
- fresh install 的 `phone/productivity.notify` 显示
  `unavailable: notification_permission_requestable`；API 36 的 `denied + canAskAgain=true` 被正确区分为
  本地可请求，而不是永久 denied。smoke 未请求权限、调度或展示通知。
- 能力页同时出现 `phone/productivity.timer_start`、`timer_cancel` 与 `timer_status`；smoke 未实际 schedule、
  cancel 或观察 pending timer，因此只证明 capability 注册/投影，不证明系统调度行为。
- fresh-install Activity 显示最近 100 条/本机最多 5,000 条范围；smoke 打开 destructive confirmation 后
  取消，再次打开并确认，页面真实报告清除 0 条。该流程没有生成远程 command audit。
- 四个 tab 暴露唯一 accessibility label 与 selected state。smoke 将系统字号设为 200%，重启后逐页
  滚动并操作 Activity clear/cancel/confirm，关键 action bounds 至少 48dp；脚本结束后恢复原字号。
- 完整命令与限制以 `docs/verification/2026-08-19-android-emulator.md` 为事实真源。

## 未由上述证据证明

- APK 未安装到真机；emulator smoke 不构成物理 haptic、媒体、系统权限对话框、位置精度、后台/锁屏
  或中断行为证据。
- bounded HTTPS source 的本地实现不证明真机音频解码、锁屏控制、后台播放、音频中断或远端服务器兼容。
- `open_map` 的 unit/contract、manifest query 和能力页 smoke 不证明 Android/iOS 真机实际 handoff、
  provider 选择、地图显示或导航成功。
- local-only config、unit/contract 与 emulator permission probe 不证明 Android/iOS 真机通知已 presented、
  clicked，也不覆盖 channel off、前后台或冷/热启动点击。
- timer 的 unit/contract、clean build 与 capability smoke 不证明 Android/iOS 真机 schedule/cancel、Doze、
  reboot 后 foreground reconcile、presentation 或 on-time；iOS 与双端真机验收均未完成。
- Activity 的 repository/contract 与 API 36 空历史 smoke 不构成 iOS 或双端真机行为证据，也不证明
  gateway/server audit、服务端清除、配对撤销或完整数据删除；emulator 未覆盖有记录的 SQLite clear。
- accessibility component/contrast tests 与 API 36 UIAutomator smoke 不证明 TalkBack/VoiceOver 实际朗读、
  手势/rotor 或平台焦点顺序、Switch Access、iOS Dynamic Type 和双端真机可访问性；这些仍未验收。
- command sqlite3 fixture 不证明 Expo SQLite 在 Android/iOS 真机上的锁争用、I/O 或 10,000 条性能；
  本地有界 tombstone 也不是 gateway 级永久 dedupe。
- `objectRef` 及其 MIME/大小/TTL 下载授权仍等待上游契约；HTTPS resolver 不能替代该对象模型。
- 本机没有完整 Xcode，因此未执行 iOS simulator build；iOS 只完成代码/配置与 autolink 静态检查。
- 未执行 release build、签名、安装 smoke、性能、24 小时稳定性、CI clean-checkout 或 artifact-to-commit
  追溯验证。
- 当前产物来自基线 commit 加未提交实现，不能满足 release DOD 的可追溯要求。
