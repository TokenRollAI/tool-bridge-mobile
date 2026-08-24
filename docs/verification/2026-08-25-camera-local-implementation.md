# 2026-08-25 前台相机本地实现验证

## 范围与行为

本记录验证 `phone/camera.capture_photo` 的移动端本地实现、`@tool-bridge/sdk/device@0.15.0`
context object upload consumer，以及 Android/iOS 配置与 bundler 边界。

本次已决定行为：

- 只在 App `active` 前台接受相机命令；后台/锁屏不等待、不拉起 UI，直接拒绝；
- Ask every time / Trusted session 先做通用本地确认，再由用户在可见预览中按快门并复核上传；
- Direct call 不再要求逐次确认或用户快门；可见预览 ready 后自动拍摄，仍显示 caller、purpose、
  自动拍摄提示、取消入口与系统相机指示；
- 照片重编码为最大 10 MiB JPEG，上传到 `camera/photos/<deviceId>/<sha256(commandId)>.jpg`；
- result 只返回稳定 `node://` objectRef、MIME、bytes、尺寸和 SHA-256，不含照片、signed URL、
  私有文件 URI 或 SDK 未提供的对象过期时间。

## 工具链与依赖

- Node.js：22.23.1（通过 `mise exec node@22.23.1`）；
- pnpm：11.21.0；
- App：0.0.8；
- Expo：57.0.16；
- `@tool-bridge/sdk`：0.15.0；
- `expo-camera`：57.0.4；
- `expo-image-manipulator`：57.0.13。

Expo 57 在 2026-08-24 更新了同 SDK 的兼容补丁表；为恢复仓库既定的 `expo install --check`，
本次同时精确升级它列出的 9 个 Expo 57 patch 包，未跨 Expo/React Native 主版本。版本、integrity 与
新发布等待期例外都进入 package、lockfile 和 `pnpm-workspace.yaml`；最终 Expo check、license、
autolinking 和 bundler 门禁通过。

## 自动化与静态门禁

使用锁定 Node 执行：

```text
mise exec node@22.23.1 -- pnpm verify
```

最终结果：

- 文档、release metadata、三环境 App config、图标、secret、license、依赖缓解全部通过；
- SDK gate 确认 `/device@0.15.0` 导出 `uploadContextObject` 且无 Node `ws/process.env` 泄漏；
- Android/iOS autolinking 均发现 ExpoCamera `CameraViewModule` 与 ExpoImageManipulator；
- `expo install --check`、strict typecheck、零 warning lint 通过；
- Jest 77 suites / 358 tests 全绿。

相机专项 contract 覆盖：strict schema/default、high/write/always descriptor、权限/hardware probe、
后台拒绝、Direct call 自动请求、Ask/Trusted 手动快门与复核、AppState 前台丢失取消、处理后清理、
固定 context/确定性 path、跨 context/错误 entry URI 拒绝、SDK create-upload + Authorization + Blob PUT、
401/403 精确 credential 失效与轮换值保留、稳定错误映射。

## Prebuild、原生构建与 Metro

Android clean prebuild 成功，生成工程发现 `expo-camera 57.0.4`、`expo-image-manipulator 57.0.13`，
并使用 min/compile/target 24/36/36。`assembleDebug` 尚未进入 App 代码编译：Maven Central 对当前环境
请求 `glide:5.0.5` 返回 HTTP 403。直接 `curl -I` 同一 POM 也得到 Cloudflare 403；使用
`--refresh-dependencies --no-daemon` 重试时，多个 Kotlin/Maven POM 同样 403。因此 Android 原生 build
本轮不记为通过，不能把网络阻塞改写成代码成功。

iOS clean prebuild 成功，但主机没有 CocoaPods，且 `xcode-select` 当前指向
`/Library/Developer/CommandLineTools`，`xcodebuild` 报告需要完整 Xcode。没有继续安装系统级 CocoaPods
或切换开发者目录，因此 iOS simulator native build 本轮不记为通过。

在两个原生 build 阻塞后补跑 production Metro：

- Android：1,602 modules，Hermes bundle 约 4.7 MiB；
- iOS：1,481 modules，Hermes bundle 约 4.4 MiB。

这只证明双端 JS bundle 可生成，不能替代 Gradle/Xcode 编译。

## 未验证项

本轮没有 Android/iOS 真机，因此以下 DOD 保持未完成：

- 真实预览、系统相机指示、快门声与物理拍照；
- Direct call 真机自动拍摄；
- 权限首次请求、拒绝、永久撤销，以及前后台/锁屏切换；
- 真实 Gateway 与可写 `camera/photos` R2/S3 context 的上传、读取和保留；
- crash 后孤儿临时文件清理；
- 服务端 upload grant 对 commandId/max bytes/TTL 的强绑定。

本轮未调用真实相机、未上传照片、未修改 Gateway/object storage、未发布版本或提交代码。
