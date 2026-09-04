# Changelog

本文件记录可发布版本中用户可感知的变化。最新版本必须位于最前，并与 `package.json`、
`app.config.ts` 和发布 tag 保持一致；自动发布流水线只提取首个版本段作为 GitHub Release 正文。

## [0.0.14] - 2026-09-05

> Preview：修复设备信箱 Markdown 链接点击，并恢复 Expo 57 自动验证与双端构建门禁；不是 production、
> App Store 或 Google Play 正式版本。

### 修复与维护

- 信箱详情页现在会把显式 Markdown HTTPS 链接渲染为可访问的点击入口；只有用户点按且链接通过本地
  结构 policy 后，才交给系统处理，系统拒绝时显示通用失败提示。
- 链接限制为不超过 2,048 字符、无 userinfo、标准端口且非 IP literal 的 HTTPS hostname；不自动
  linkify 裸 URL，也不接受 `http:`、`mailto:`、`tel:` 或 custom scheme。
- 将 `@tool-bridge/sdk` 更新到 0.21.0，并保持正式 device mailbox consumer、journal 与
  `delivery: both` 契约；这不新增 push、后台轮询或后台必达。
- 将 Expo 57 相关包对齐到当前官方兼容补丁版本，修复 `expo install --check` 对旧补丁版本的拒绝。

### 安全与验证边界

- 本版本不新增系统权限、后台入口或任意 App UI 自动化；Markdown 链接只能由用户主动点按。
- 本地 typecheck、lint、单元/协议测试、Expo dependency check 与 Expo Doctor 通过；GitHub Preview
  仍以 clean checkout 的 Android APK 和 iOS simulator workflow 结果为准，不代表双端真机验收。

## [0.0.13] - 2026-08-29

> Preview：让设备本地信箱可经 Tool Bridge durable mailbox 投递；不是 production、
> App Store 或 Google Play 正式版本。

### 新增与变更

- 将 `@tool-bridge/sdk` 精确升级到 0.20.1，消费正式 `createDeviceMailboxProcessor`、
  `DeviceOperationJournal` 和 command `delivery` metadata，不复制上游协议源码。
- `phone/inbox.deliver` 对 Gateway 宣告 `delivery: both`，保留 realtime 直调并允许 caller 显式
  选择 mailbox/fallback；`phone/productivity.notify` 仍是 realtime-only。
- 新增 SQLite v5 installation-local operation journal。`discovered/executing/terminal` barrier 先持久化
  再进入副作用；崩溃恢复时不重放已进入 executing 的命令，而是保守提交
  `result_unknown`。journal 不保存命令 arguments、消息正文或凭证。
- App 在初始化、Gateway 配置完成和回到前台时执行一次有界 mailbox drain；
  切到后台、Disabled、换配置或凭证被拒绝会中止拉取并联动 realtime transport。

### 安全与验证边界

- mailbox 不自启 timer、不注册 APNs/FCM token，也不提供 push 或后台必达；用户未重新打开
  App 时，设备不会因此发起新的拉取。本版本没有新增系统权限或远程通知入口。
- consumer contract 覆盖 delivery 投影、claim/complete、journal barrier、正文脱敏、崩溃后
  `result_unknown`、前后台中止与 401 凭证联动；它们不替代真实 Gateway、真机、弱网、
  锁屏或系统终止进程证据。

## [0.0.12] - 2026-08-28

> Preview：修复 Android 15+ 后台 `dataSync` 前台服务超时后的崩溃与重启循环；不是 production、
> App Store 或 Google Play 正式版本。

### 修复与维护

- Android 在 `dataSync` 后台配额耗尽时通过 `onTimeout` 立即停止前台服务，避免
  `ForegroundServiceDidNotStopInTimeException` 终止进程。
- 服务改为 `START_NOT_STICKY`；系统回收后不再重建一个无法恢复 JS runtime/device connection 的空服务，
  也避免在配额仍耗尽时再次触发 `ForegroundServiceStartNotAllowedException`。
- 将 Expo SDK 57、React Native 及相关测试/构建依赖对齐到当前官方兼容 patch 版本，恢复 release verify
  的版本一致性门禁。

### 证据与已知限制

- 锁定 Node 22.23.1 下完整 `pnpm verify`、79 个 Jest suites/367 个 tests 与 Android Preview release
  clean build 已通过；新增静态契约锁定 `onTimeout -> stopSelf()` 和非 sticky 重启策略。
- 本机没有完整 Xcode，当前也没有在线 ADB 设备，因此本版本尚未形成 iOS build 或 Android 锁屏、Doze、
  6 小时配额耗尽的真机回归证据。
- 修复只切断超时崩溃链，不增加 Android 后台预算，也不承诺息屏或进程回收后仍在线。可靠后台投递仍依赖
  上游 durable mailbox 与仅携带不透明引用的 APNs/FCM wake。

## [0.0.11] - 2026-08-26

> Preview：修复真实远程拍照完成后无法交付对象，并升级 Tool Bridge device SDK；不是 production、
> App Store 或 Google Play 正式版本。

### 修复与变更

- 将 `@tool-bridge/sdk` 精确升级到 0.17.0，移除已废弃的 `uploadContextObject` / `camera/photos` Context
  假设，改用网关为每次 device call 注入的窄 `call.uploadObject` Store capability。
- 相机结果改为稳定 `store://default/...` 引用；上传同时提交 JPEG size、SHA-256、脱敏文件名和基于
  commandId 摘要的幂等键，并复核 Gateway 返回的对象描述。
- 缺少本次调用的 Store upload capability 时，在本地确认、相机 probe 和打开预览前 fail closed。
- Android Preview 构建在 prebuild 与 Gradle bundle 两阶段都保持 `APP_VARIANT=preview`，避免 native
  package 是 Preview、内嵌 JS 配置却回落 Development。

### 证据与已知限制

- 旧 0.0.9 真机日志已证明远程命令实际打开相机、生成并重编码 JPEG；失败发生在旧 Context 上传，且照片
  按设计只存在于 App 私有临时文件，不写入系统相册。
- SDK 0.17 的 `call.uploadObject` 只使用 SDK 原始 call signal，不接受 App 的前台丢失 signal；上传开始后
  切后台仍可能产生未返回的 Store 对象。当前会拒绝成功结果并清理本地文件，但完整中止需上游支持组合 signal。
- Android Preview 0.0.11 已完成 APK native/JS variant 反查、ADB 覆盖安装和一次真实远程后摄调用；相机
  日志记录 `takePictureInternal` / `onImageCaptured`，Store 对象为 `ready`，受保护读回的 JPEG MIME、
  11,569 字节与 SHA-256 均和设备返回一致。
- 同一源码随后在锁定 Node 22.23.1 下再次完成 release clean build；最终 APK 覆盖安装后恢复
  active/online/direct_call。为避免重复副作用，没有在该重建 artifact 上再次拍照。
- iOS simulator build 已尝试，但本机只有 Command Line Tools、缺少完整 Xcode/CocoaPods，尚未形成 iOS
  build 或真机证据；未自动安装系统级工具链。

## [0.0.10] - 2026-08-25

> Preview：修复 Android/iOS 前台相机硬件探测，不是 production、App Store 或
> Google Play 正式版本。

### 修复

- 不再在 Android/iOS 上调用 Web-only 的 `CameraView.isAvailableAsync()`，改为通过 Camera2 与
  AVFoundation 只读枚举设备的前/后镜头，避免有权限且硬件正常时误报 `camera_probe_failed`。
- 在本地确认前检查请求的 `facing`；设备缺少对应镜头时稳定返回
  `camera_facing_unavailable`，并保留不向远端暴露原生异常的边界。

### 验证边界

- Android Preview release clean build、全量 `pnpm verify` 与 Android 真机前置镜头的可见预览、
  自动拍摄和本地图像处理已通过。
- Gateway 尚未挂载可写 `camera/photos` context，因此真实对象上传 E2E 未完成；iOS 原生
  build 和真机需在安装完整 Xcode/CocoaPods 的环境继续验收。

## [0.0.9] - 2026-08-25

> Preview：供内部验证前台相机拍摄与 Tool Bridge 对象上传，不是 production、App Store 或
> Google Play 正式版本。

### 新增

- 新增仅前台的 `phone/camera.capture_photo`，支持前后摄像头和 low/medium/high 三档 JPEG；结果只返回
  稳定 `node://` object reference、尺寸、大小和 SHA-256，不返回照片、私有文件 URI、signed URL 或 EXIF。
- Ask every time / Trusted session 由用户按快门并复核；用户主动选择的 Direct call 仍展示可见预览，
  预览就绪后自动拍摄和上传。

### 变更

- 将 `@tool-bridge/sdk` 精确升级到 0.15.0，通过公开的 `uploadContextObject` 写入固定
  `camera/photos` context，不复制上游私有源码。
- 上传路径使用 `<deviceId>/<sha256(commandId)>.jpg`，默认禁止覆盖，并重新校验 SecureStore credential；
  401/403 只清除与本次调用完全匹配的旧凭证。

### 安全与验证边界

- 相机只允许 App 前台 active 状态；后台、锁屏、deadline/cancel、权限拒绝或硬件不可用会拒绝或终止命令。
- 仅声明 Camera 权限，关闭麦克风、录音、条码扫描和 EXIF；原始/输出分别限制为 30/10 MiB，并对已知路径
  best-effort 清理临时文件。
- Node 22.23.1 / pnpm 11.21.0 下 `pnpm verify`、双端 clean prebuild、原生模块 autolinking 与 production
  Metro bundle 已通过；自动发布以 `main` verify 的 Android Preview 与 iOS simulator 构建为门禁，双端真机
  相机和真实 Gateway/storage 联合验收仍需后续设备证据。
- pairing、最小权限设备凭证、短期 ticket、durable mailbox/push、通用 objectRef 读取与完整服务端对象
  grant 强绑定仍未实现。

## [0.0.8] - 2026-08-23

- 将设备本地信箱 Markdown 正文上限从 4,000 提高到 64,000 字符，并保持 1,000 条保留、图片安全加载与
  普通日志/审计脱敏边界。

## [0.0.7] - 2026-08-23

- 将底部导航收敛为信箱、活动、设置三个 tab，并把信箱改为新闻/邮件式列表。

## [0.0.6] - 2026-08-23

- 升级 Tool Bridge device wire，并交付在线 direct call 到达后可持久化、检索和管理的设备本地信箱。

## [0.0.5] - 2026-08-20

- 新增应用图标和受系统 torch API 约束的 attention flash 通道。

## [0.0.4] - 2026-08-20

- 重构移动端视觉与底部标签栏图标，不改变本地策略、确认和原生权限边界。

## [0.0.3] - 2026-08-19

- 探索高特权能力、Direct call、Android 前台服务与新版 UI；后续安全收敛以当前代码和 `llmdoc/` 为准。

## [0.0.2] - 2026-08-19

- 增加 Android 前台连接诊断分类和敏感信息脱敏。

## [0.0.1] - 2026-08-19

- 首个内部 Preview，包含移动端脚手架、前台 device transport、本地安全执行链和基础能力。

[0.0.14]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.14
[0.0.13]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.13
[0.0.12]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.12
[0.0.11]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.11
[0.0.10]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.10
[0.0.9]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.9
[0.0.8]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.8
[0.0.7]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.7
[0.0.6]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.6
[0.0.5]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.5
[0.0.4]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.4
[0.0.3]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.3
[0.0.2]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.2
[0.0.1]: https://github.com/TokenRollAI/tool-bridge-mobile/releases/tag/v0.0.1
