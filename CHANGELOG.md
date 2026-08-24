# Changelog

本文件记录可发布版本中用户可感知的变化。最新版本必须位于最前，并与 `package.json`、
`app.config.ts` 和发布 tag 保持一致；自动发布流水线只提取首个版本段作为 GitHub Release 正文。

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
