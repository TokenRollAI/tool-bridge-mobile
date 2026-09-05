# tool-bridge-mobile

[![verify](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/verify.yml)
[![auto-release-preview](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/auto-release.yml/badge.svg)](https://github.com/TokenRollAI/tool-bridge-mobile/actions/workflows/auto-release.yml)
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
> 本机活动审计，以及由 Agent 通过在线 direct call，或由 Gateway durable mailbox 入队并在
> App 启动/回到前台后显式拉取投递、在 SQLite 中保留最近 1,000 条并可选发出
> 固定隐私提醒的设备本地信箱；单条正文支持最多 64,000 字符的 Markdown、用户主动安全加载的 HTTPS
> 图片、用户点按后交给系统打开的有界 HTTPS 链接、紧急程度、可选 Agent 发送时间、全文搜索、列表排序、
> 未读筛选与单条/全部已读。页面支持跟随系统的浅深主题，具有无障碍语义自动化基线与持久化/并发幂等测试。
> 本地执行还包含确认前 caller/global admission、inline 结果字节上限、claim 后取消/到期复检和
> emergency disable 的进行中命令取消。
> SDK expose 现在为每个公开工具同时提供输入/输出 JSON Schema，并只注册静态配置完整的 App/媒体
> 工具；`phone/runtime.capabilities/pending_commands/cancel` 提供当前 credential principal 范围内的
> 本地能力、活动命令与取消控制。
> 当前还实现了仅前台的 `phone/camera.capture_photo`：Ask every time / Trusted session 会在可见预览中
> 由用户按快门并复核，用户主动选择的 Direct call 会在可见预览就绪后自动拍摄；照片重编码为有界 JPEG，
> 通过本次 call 的窄 Store capability 上传，协议结果只含受保护的 `store://default/...` 引用与元数据。
> 当前已精确锁定并接入 `@tool-bridge/sdk/device@0.21.0`：Android/iOS realtime transport 使用官方
> hello/ready/call/result、心跳、重连与 cancel，支持命令叶子并入 path 的新 device wire 与网关签发
> invocation context，并使用官方 call-scoped Store upload。`phone/inbox.deliver` 另声明
> `delivery: both`，并通过官方 mailbox processor 执行 claim/lease/complete；调用继续经过本地安全
> 执行链，只有收到 gateway ready
> 才显示 online。Android Preview 0.0.6 已通过当前 Railway Gateway 的单次真机
> `status/get` 直连读调用；该证据不外推到其他能力、iOS、后台、弱网或完整 pairing。
> 当前内测入口允许用户在本机填写 Gateway HTTPS URL 与 API key，secret 只进入
> SecureStore；这不等于 pairing、最小权限设备凭证或短期 ticket。设备本地信箱是正文存储域，
> Gateway command mailbox 是 durable operation 投递域；当前只在 App 启动/回到前台时有界拉取，
> 没有远程 push、隐式后台轮询或后台必达。通用 object 读取/生命周期契约仍等待
> [上游交付](llmdoc/integration/upstream-and-platform-gaps.mdx)。

## 它解决什么问题

Agent 今天大多只能调用云端 API。这个项目让 Agent 在用户许可范围内继续完成现实世界任务：

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
| [工程基线](llmdoc/delivery/engineering-baseline.mdx) | React Native / Expo 取舍、版本和构建环境 |
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
pnpm start
```

`pnpm start` 面向 development build，不以 Expo Go 为验收环境。`pnpm verify` 当前覆盖文档链接、
三环境配置、SDK RN 子入口漂移、secret/license/dependency 检查、Expo 依赖一致性、strict typecheck、
零 warning lint、unit/component 和本地/SDK transport 契约测试。

主导航为信箱、活动、设备。信箱提供固定搜索/筛选工具栏和独立阅读页，排序与批量操作进入本地操作面板；
设备总览分别进入连接配置、授权与安全、能力和运行详情。

安装 App 后可在“设备 → 连接配置”中填写纯 HTTPS origin 和 Tool Bridge API key。API key 不应写入
`.env`、`EXPO_PUBLIC_*`、源码或 URL；保存时 App 会先停止旧连接，再把 key 写入系统 SecureStore。
SDK `deviceId` 默认由设备硬件标识（Android ID / iOS IDFV）经单向摘要派生为稳定短 ID，跨重装保持
不变；也可在同一表单中自定义（字母、数字、`.`、`_`、`-`，最长 64 字符）。设备声明挂载到
`device/phone/<deviceId>`。该 deviceId 不是网关签发身份，手工入口只是 pairing 交付前的内测通道。

相机上传要求目标 Gateway 支持 SDK 0.21.0 兼容的 call-scoped Store，并为本次 device call 注入有界、短期 upload capability。
App 不接收 capability token、signed upload URL，也不会把照片字节放进 HTBP JSON result；缺少该 capability
时会在本地确认和打开相机前拒绝。

原生构建命令：

```bash
pnpm build:android:debug
pnpm build:android:preview
pnpm build:ios:sim
```

`build:android:preview` 生成 application id 为 `ai.tokenroll.toolbridgemobile.preview`、内嵌 JS 的内部体验
APK。GitHub Actions 的 `android-preview-apk` job 会上传 APK 与 SHA-256，artifact 保留 14 天。该包使用
生成的 debug test key 签名，只用于内部试用；它不是生产签名、商店 release 或 release DOD 证据。
验证口径和已知证据边界见
[验证证据索引](llmdoc/delivery/verification-evidence.mdx)。

## 版本与 GitHub 预发布

当前 App/package 版本为 `0.0.14`。版本变更合并到 `main` 后，[`verify`](.github/workflows/verify.yml)
全绿会触发 [`auto-release-preview`](.github/workflows/auto-release.yml)：当 `package.json` 对应 tag 尚不存在时，
它复用该次已通过双端门禁的 Android artifact，核对 package、Expo App 版本与 `CHANGELOG.md` 最新版本段，
再创建版本 tag 和 GitHub Pre-release，并附带版本化 APK 与 SHA-256。版本已发布时幂等跳过；新的 main
提交已经出现时，由更新 commit 的 verify run 决定是否发布，避免发布过期 SHA。

手工推送匹配 `vX.Y.Z` 的 tag 仍可触发 [`release-preview`](.github/workflows/release.yml) 作为恢复路径；
该路径会重新执行 frozen install、全量 verify、peer/dependency gate、Android Preview APK clean build 与
iOS simulator build。如果自动流程已经创建 tag、但发布资产阶段失败，也可以通过该 workflow 的
`workflow_dispatch` 输入现有 tag 重新验证并补发。两条路径都只提取 [CHANGELOG](CHANGELOG.md) 最上方、
与版本一致的段落作为 Release 正文。

版本页面：[GitHub Releases](https://github.com/TokenRollAI/tool-bridge-mobile/releases)。当前自动发布仍是
内部 Preview：APK 使用 debug test key，且不会自动上传商店、创建 production AAB/IPA 或假装满足
[Release DOD](llmdoc/delivery/definition-of-done.mdx)。

仓库同时绑定到 Expo 项目 [`@tokenroll/tool-bridge`](https://expo.dev/accounts/tokenroll/projects/tool-bridge)，
development / preview / production 共用 EAS Project ID，但继续使用不同的 application id、bundle id、
scheme 和显示名称。验证绑定或触发 EAS 内部分发 APK：

```bash
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas project:info
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas build --platform android --profile preview
```

EAS `preview` profile 固定 Node 22.23.1、`APP_VARIANT=preview`、preview environment 与 APK 输出。EAS
环境中的 `EXPO_PUBLIC_*` 都会进入客户端，不能存放凭证、token 或私钥；
`EXPO_PUBLIC_GATEWAY_ORIGIN` 只可作为非秘密 URL 预置，本机连接配置优先。未配置 media/link
变量时，相应能力保持 unavailable。

Android development debug APK 构建完成、API 36 emulator 已启动且另一个终端正在运行 `pnpm start`
时，可以执行可重复 UI smoke：

```bash
pnpm verify:android:emulator
```

该脚本会卸载 emulator 中的 dev application id 后重新安装 APK，并验证安装后权限、信箱首页与设备分层导航、动态
能力、local-only 通知/timer 边界、紧急停用重启持久化、三个标签页的唯一语义，以及关键页面在 200%
系统字号下的名称、选中状态和操作最小尺寸；不会操作 preview/production 包，也不替代 TalkBack、VoiceOver
或真机验收。

Android 需要 Java 17；iOS 需要 macOS、Xcode 26.4+ 与 CocoaPods。涉及 push、后台、相机、音频、
位置或权限的功能仍必须按 [DOD](llmdoc/delivery/definition-of-done.mdx) 留下双端真机证据。

## License

MIT
