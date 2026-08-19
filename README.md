# tool-bridge-mobile

[![verify](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml)
[![release-preview](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/release.yml/badge.svg)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/release.yml)

让 Agent 的能力边界从云端延伸到用户明确授权的手机。

`tool-bridge-mobile` 是 HTBP / Tool Bridge 生态中的移动设备运行时。它把 Android 和 iOS
设备上的状态、提醒、媒体、位置、相机等能力，以可发现、可授权、可审计的 Tool Bridge
节点暴露给 Agent。

> 当前状态：**P0 本地安全运行时已开始实现，尚未达到 MVP**。仓库已有 Expo development-build
> 双端脚手架、本地状态页、SecureStore `installationId`、SQLite command/audit、动态 probe、
> policy、跨标签页全局单命令本地确认、前台内置提示音/haptic attention、受 HTTPS allowlist、
> 25 MiB 流式下载与 2 小时播放时长上限约束且支持 seek 的 App 自有媒体会话，
> 受控 HTTPS App handoff、只接受结构化目标的地图 handoff、逐次确认的一次性前台位置、由用户在
> App 内主动授权的即时本地通知、以 SQLite 为真源的单次 App 内计时器、可解释且可由用户单独清除的
> 本机活动审计、跨四个本地页面的无障碍语义自动化基线，以及持久化/并发幂等测试。
> 本地执行还包含确认前 caller/global admission、inline 结果字节上限、claim 后取消/到期复检和
> emergency disable 的进行中命令取消。
> SDK expose 现在为每个公开工具同时提供输入/输出 JSON Schema，并只注册静态配置完整的 App/媒体
> 工具；`phone/runtime.capabilities/pending_commands/cancel` 提供当前 credential principal 范围内的
> 本地能力、活动命令与取消控制。
> 当前已精确锁定并接入 `@tool-bridge/sdk/device@0.11.0`：Android/iOS 前台 transport 使用官方
> hello/ready/call/result、心跳、重连与 cancel，调用继续经过本地安全执行链；只有收到 gateway ready
> 才显示 online。当前内测入口允许用户在本机填写 Gateway HTTPS URL 与 API key，secret 只进入
> SecureStore；这不等于 pairing、最小权限设备凭证或短期 ticket，mailbox、objectRef 与远程 push 仍
> 等待[上游交付](docs/UPSTREAM.md)。

## 它解决什么问题

Agent 今天大多只能调用云端 API。这个项目让 Agent 在用户许可范围内继续完成现实世界任务：

- “帮我找手机”——让指定设备响铃、震动、闪灯，并返回是否已被用户找到；
- “在手机上放首歌”——控制本 App 的播放队列，或打开用户选择的音乐 App；
- “看看路由器指示灯”——请求用户确认后调用相机，拍一张照片并返回对象引用；
- “我到公司时提醒我提交报销”——创建本地提醒或地理围栏任务；
- “把这个地址在手机地图里打开”——通过受控深链交给系统应用。

它不是远程桌面、监控软件或 MDM。系统权限、用户确认和平台限制始终优先于 Agent 指令。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [PRD](docs/PRD.md) | 用户、场景、范围、需求和产品验收 |
| [能力目录](docs/CAPABILITIES.md) | 计划暴露的节点、工具、权限和阶段 |
| [系统架构](docs/ARCHITECTURE.md) | 组件、连接、唤醒、命令生命周期和媒体传输 |
| [SDK 使用](docs/SDK.md) | 当前 SDK 事实、移动端接入方式和上游缺口 |
| [技术选型](docs/TECH-STACK.md) | React Native / Expo 方案及取舍 |
| [安全与平台约束](docs/SECURITY.md) | 配对、授权、审计、iOS / Android 限制 |
| [上游依赖](docs/UPSTREAM.md) | Tool Bridge 与 HTBP 需要同步交付的能力 |
| [路线图](docs/ROADMAP.md) | P0 到 P3 的实现顺序 |
| [Definition of Done](docs/DOD.md) | 仓库、功能、版本与场景验收闸门 |
| [ADR-0001](docs/adr/0001-react-native-expo.md) | React Native + Expo 技术决策 |
| [ADR-0002](docs/adr/0002-app-scaffold-baseline.md) | 精确版本、最低平台和环境标识基线 |

## 仓库边界

这个仓库拥有：

- Android / iOS App；
- 设备运行时、权限与用户确认 UI；
- 移动端原生模块（Kotlin / Swift）；
- 本地队列、审计记录和凭证安全存储；
- 移动端集成、端到端测试和商店构建配置。

这个仓库不拥有：

- HTBP 通用协议定义：在 [TokenRollAI/HTBP](https://github.com/TokenRollAI/HTBP)；
- 网关、通用 SDK、设备命令邮箱和对象存储：在
  [TokenRollAI/tool-bridge](https://github.com/TokenRollAI/tool-bridge)；
- 浏览器扩展：后续单独放在 `tool-bridge-browser`。

## 开发原则

1. **能力可发现**：Agent 以运行时 `~help` / capability profile 为准，不猜平台能力。
2. **平台诚实**：不可用就返回结构化 unavailable，不伪装执行成功。
3. **最小权限**：权限按功能逐次申请，不在首次启动索取全部权限。
4. **敏感动作可见**：相机、麦克风、持续定位等必须有系统指示与本地确认。
5. **结果可审计**：每次远程调用都有调用方、能力、时间、决策和结果记录。
6. **大对象走引用**：照片、音频和视频不上塞 HTBP JSON 帧。

## 本地启动与验证

使用仓库锁定的 Node 22.23.1 与 pnpm 11.21.0：

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm start
```

`pnpm start` 面向 development build，不以 Expo Go 为验收环境。`pnpm verify` 当前覆盖文档链接、
三环境配置、SDK RN 子入口漂移、secret/license/dependency 检查、Expo 依赖一致性、strict typecheck、
零 warning lint、unit/component 和本地/SDK transport 契约测试。

安装 App 后可在首页“网关连接设置”中填写纯 HTTPS origin 和 Tool Bridge API key。API key 不应写入
`.env`、`EXPO_PUBLIC_*`、源码或 URL；保存时 App 会先停止旧连接，再把 key 写入系统 SecureStore，
并用当前安装实例派生的稳定 `mobile_<uuid>` 作为客户端声明的 SDK `deviceId`。该 deviceId 不是网关
签发身份，手工入口只是 pairing 交付前的内测通道。

原生构建命令：

```bash
pnpm build:android:debug
pnpm build:android:preview
pnpm build:ios:sim
```

`build:android:preview` 生成 application id 为 `ai.tokenroll.toolbridgemobile.preview`、内嵌 JS 的内部体验
APK。GitHub Actions 的 `android-preview-apk` job 会上传 APK 与 SHA-256，artifact 保留 14 天。该包使用
生成的 debug test key 签名，只用于内部试用；它不是生产签名、商店 release 或 release DOD 证据。
本地构建与安装证据见 [Android preview APK 验证记录](docs/verification/2026-08-19-android-preview-apk.md)。

## 版本与 GitHub 预发布

当前 App/package 版本为 `0.0.2`。推送匹配 `vX.Y.Z` 的 tag 时，
[`release-preview`](.github/workflows/release.yml) 会先验证 tag、`package.json`、Expo App 版本和对应
`docs/releases/<tag>.md` 完全一致，再执行 frozen install、全量 verify、peer/dependency gate、Android
preview APK clean build 与 iOS simulator build。所有门禁成功后才创建 GitHub Pre-release，并附带
版本化 APK 与 SHA-256。

版本页面：[GitHub Releases](https://github.com/TokenRollAI/tool-bridge-mobile/releases)。当前自动发布仍是
内部 Preview：APK 使用 debug test key，且不会自动上传商店、创建 production AAB/IPA 或假装满足
[Release DOD](docs/DOD.md#8-release-dod)。

仓库同时绑定到 Expo 项目 [`@tokenroll/tool-bridge`](https://expo.dev/accounts/tokenroll/projects/tool-bridge)，
development / preview / production 共用 EAS Project ID，但继续使用不同的 application id、bundle id、
scheme 和显示名称。验证绑定或触发 EAS 内部分发 APK：

```bash
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas project:info
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas build --platform android --profile preview
```

EAS `preview` profile 固定 Node 22.23.1、`APP_VARIANT=preview`、preview environment 与 APK 输出。EAS
环境中的 `EXPO_PUBLIC_*` 都会进入客户端，不能存放凭证、token 或私钥；
`EXPO_PUBLIC_GATEWAY_ORIGIN` 只可作为非秘密 URL 预置，首页本机 URL 配置优先。未配置 media/link
变量时，相应能力保持 unavailable。

Android development debug APK 构建完成、API 36 emulator 已启动且另一个终端正在运行 `pnpm start`
时，可以执行可重复 UI smoke：

```bash
pnpm verify:android:emulator
```

该脚本会卸载 emulator 中的 dev application id 后重新安装 APK，并验证安装后权限、首页状态、动态
能力、local-only 通知/timer 边界、紧急停用重启持久化，以及四个标签页在 200% 系统字号下的语义
名称、选中状态和关键操作最小尺寸；不会操作 preview/production 包，也不替代 TalkBack、VoiceOver
或真机验收。

Android 需要 Java 17；iOS 需要 macOS、Xcode 26.4+ 与 CocoaPods。涉及 push、后台、相机、音频、
位置或权限的功能仍必须按 [DOD](docs/DOD.md) 留下双端真机证据。

## License

MIT
