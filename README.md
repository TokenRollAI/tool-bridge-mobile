# tool-bridge-mobile

[![verify](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml)
[![auto-release-preview](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/auto-release.yml/badge.svg)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/auto-release.yml)
[![release-preview](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/release.yml/badge.svg)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/release.yml)

让 Agent 的能力边界从云端延伸到用户明确授权的手机。

`tool-bridge-mobile` 是 HTBP / Tool Bridge 生态中的移动设备运行时。它把 Android 和 iOS
设备上的状态、提醒、媒体、位置、相机等能力，以可发现、可授权、可审计的 Tool Bridge
节点暴露给 Agent。

**现状**　Android 在 `native-android/` 中使用 Kotlin 和 Android 原生 Views，APK 无需 React Native、Expo 或 Metro。iOS 沿用 React Native、Expo development build 和官方 device SDK。两端都提供本机信箱与设备页面，通过 Gateway 连接；项目仍处于 P0。

信箱支持实时投递和显式前台拉取，正文保存在设备本地。响铃、媒体、位置、相机、通知和计时器的可用性取决于本机配置、系统权限与设备状态，调用方可通过能力列表查询。只有收到网关 ready 才显示在线。

**Android 远控**　在手机解锁且网关在线时，用户进入“设备 → 远控配置”，在系统设置中启用无障碍服务，允许显示结束控制通知，勾选本次允许的 App，再点“开始 5 分钟”。Agent 只能实时读取或操作所选 App 当前的应用窗口。手机页面或通知都能结束控制；到时、熄屏或断线后需在本机重新开始。Android 14 及以上可对该窗口截图，调用方收到受保护的图片引用。旧版的 `phone/system.exec_shell` 未在原生 App 注册。iOS 沿用原有能力集。

**安装原生 Preview**　旧 Expo Preview（`ai.tokenroll.toolbridgemobile.preview`）使用 Expo 模板随附的公开调试证书。原生 Preview 的包名为 `ai.tokenroll.toolbridgemobile.nativepreview`，对外分发须使用项目私有发布签名。安装新包时保留旧 App 即可，原有信箱、设置和凭证继续留在旧包内；首次打开新包需重新配置连接和授权。

## 它解决什么问题

项目围绕以下用户场景开发，各能力的实现与验收状态见下方知识地图。

- “帮我找手机”——让指定设备响铃、震动、闪灯，并返回是否已被用户找到；
- “在手机上放首歌”——控制本 App 的播放队列，或打开用户选择的音乐 App；
- “看看路由器指示灯”——在前台可见预览中拍照并返回受保护对象引用；Direct call 模式无需再按快门；
- “我到公司时提醒我提交报销”——创建本地提醒或地理围栏任务；
- “把这个地址在手机地图里打开”——通过受控深链交给系统应用。
- “把每天的订阅摘要发到这台手机”——投递 Markdown 到设备本地信箱，用户可搜索、排序并管理已读状态。

它不是远程桌面、监控软件或 MDM。系统权限、用户确认和平台限制始终优先于 Agent 指令。

## 知识地图

| 文档 | 内容 |
| --- | --- |
| [产品、现状与仓库架构](llmdoc/architecture.mdx) | 产品边界、数据流、已决定事项和未实现项 |
| [需求与路线图](llmdoc/product/requirements-and-roadmap.mdx) | 用户场景、阶段目标、范围和出口条件 |
| [能力架构](llmdoc/capabilities/architecture.mdx) | 节点、工具、风险、确认策略和主题路由 |
| [运行时架构](llmdoc/runtime/architecture.mdx) | 命令生命周期、持久化、并发和取消 |
| [SDK device transport](llmdoc/integration/sdk-device-transport.mdx) | 当前 SDK 事实、移动端接入方式和兼容边界 |
| [安全边界](llmdoc/runtime/safety-boundaries.mdx) | 凭证、授权、审计、隐私和平台限制 |
| [上游缺口](llmdoc/integration/upstream-and-platform-gaps.mdx) | Tool Bridge 与 HTBP 需要同步交付的能力 |
| [工程基线](llmdoc/delivery/engineering-baseline.mdx) | Android 原生与 iOS Expo 工程、版本和构建环境 |
| [Definition of Done](llmdoc/delivery/definition-of-done.mdx) | 仓库、能力、版本与场景验收闸门 |
| [Changelog](CHANGELOG.md) | 最新发布说明和历史版本摘要 |

`llmdoc/` 是项目持续知识源；代码、HTBP 正式规范和 Tool Bridge 已发布 API 仍是事实真源。单次机器、
commit 和 workflow 证据不复制成静态文档，以 Git 历史、Actions run 和发布资产为追溯来源。

## 仓库边界

这个仓库拥有：

- Android / iOS App；
- 设备运行时、权限与用户确认 UI；
- 移动端原生模块（Kotlin / Swift）；
- 本地队列、审计记录和凭证安全存储；
- 设备本地信箱内容、未读状态与用户清空入口；
- 移动端集成、端到端测试和商店构建配置。

这个仓库不拥有：

- HTBP 通用协议定义：在 [TokenRollAI/HTBP](https://github.com/TokenRollAI/HTBP)；
- 网关、通用 SDK、持久化设备命令邮箱、push 分发和对象存储：在
  [TokenRollAI/tool-bridge](https://github.com/TokenRollAI/tool-bridge)；
- 浏览器扩展：后续单独放在 `tool-bridge-browser`。

## 开发原则

1. **能力可发现**：Agent 以运行时 `~help` / capability profile 为准，不猜平台能力。
2. **平台诚实**：不可用就返回结构化 unavailable，不伪装执行成功。
3. **最小权限**：权限按功能逐次申请，不在首次启动索取全部权限。
4. **敏感动作可见**：相机、麦克风、持续定位等必须有系统指示；逐次确认可由用户主动选择的
   Direct call 前台策略替代，但不能绕过系统权限、可见 UI 或平台限制。
5. **结果可审计**：每次远程调用都有调用方、能力、时间、决策和结果记录。
6. **大对象走引用**：照片、音频和视频不上塞 HTBP JSON 帧。

## 本地启动与验证

使用仓库锁定的 Node 22.23.1 与 pnpm 11.21.0：

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm test:android
```

Android 接好设备或启动模拟器后运行 `pnpm android`，安装并打开原生开发版。iOS 使用 `pnpm ios` 运行 development build，`pnpm start` 启动其 Metro 服务。`pnpm verify` 当前覆盖文档链接、
三环境配置、SDK RN 子入口漂移、secret/license/dependency 检查、Expo 依赖一致性、strict typecheck、
零 warning lint、unit/component 和本地/SDK transport 契约测试。

主导航为信箱、设备。信箱提供固定搜索/筛选工具栏和独立阅读页，排序与批量操作进入本地操作面板；
设备总览分别进入连接配置、授权与安全、能力、运行详情和活动记录。

在“设备 → 连接配置”填写 Gateway HTTPS origin 和 API key。Android 用 Android Keystore 保护凭证，iOS 使用 SecureStore。不要把 key 写入 URL、源码或构建变量。设备声明的挂载路径为 `device/phone/<deviceId>`，该 ID 可在本机自定义。手工配置是配对功能交付前的内测入口。

前台相机和 Android 窗口截图都需要本次调用的 Store 上传授权，结果只返回受保护对象引用与元数据。2026-08-26 的 Android 后置相机上传与受保护回读、2026-09-03 的 Preview 安装和冷启动记录属于旧 Expo 包；2026-11-25，原生 Android 在 Android 16（API 36）隔离模拟器上接通本地 Tool Bridge 网关和 S3，验证了授权窗口操作、截图上传、越界拒绝和信箱投递。本轮未使用物理真机，也未向商店发布。[验收记录](llmdoc/delivery/verification-evidence.mdx)

原生构建命令：

```bash
pnpm build:android:debug
pnpm build:android:preview
pnpm build:ios:sim
```

`build:android:debug` 构建开发版。`build:android:preview` 构建 PreviewLocal（`ai.tokenroll.toolbridgemobile.nativepreview.local`），使用本机调试签名，关闭调试，供本地和 CI 检查。对外分发须用项目私有发布签名构建 PreviewRelease（`pnpm build:android:release`），并核对 APK 包名、签名证书及 SHA-256。Android 需要 Java 17，iOS simulator 构建需要 macOS、Xcode 与 CocoaPods。

## 版本与 GitHub 预发布

版本取自 `package.json`，tag 与 `CHANGELOG.md` 首个版本段须一致。main 自动发布使用通过 verify 的 main 提交，tag 发布或手工恢复使用重新验证的 tag 提交。两条路径共用 `.github/actions/sign-android-preview` 重建 PreviewRelease，使用项目私有发布签名，APK 验签和 iOS simulator 门禁通过后才发布 GitHub Pre-release。分发时还须核对实际签名证书指纹。[发布流程](llmdoc/delivery/github-preview-release.mdx) · [验证证据](llmdoc/delivery/verification-evidence.mdx) · [GitHub Releases](https://github.com/TokenRollAI/tool-bridge-mobile/releases)

iOS 的 Expo/EAS 项目仍为 `@tokenroll/tool-bridge`，配置按 development、preview 和 production 隔离。涉及远控、相机、音频、权限或后台的行为按适用平台分别留下真机证据。[验收条件](llmdoc/delivery/definition-of-done.mdx)

## License

MIT
