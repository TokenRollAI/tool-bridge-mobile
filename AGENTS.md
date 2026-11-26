# AGENTS.md

本文件面向在 `tool-bridge-mobile` 工作的人类和编码 Agent。

## 沟通与事实

- 默认使用简体中文沟通和写产品文档；代码标识符、协议字段保持英文。
- 代码、HTBP 正式规范和 Tool Bridge 已发布 API 是事实真源；`README.md` 或 `llmdoc/` 与实现冲突时
  先核实，再同步知识面。
- 用 `现状`、`已决定`、`提案`、`未实现` 明确区分事实与计划。
- 不把设计示例写成当前 SDK 可运行示例。

## 仓库边界

- 本仓库只拥有移动 App、移动端运行时和相关原生模块。
- 通用协议、网关、跨运行时 SDK 必须在上游仓库交付；禁止长期复制
  `@tool-bridge/core` 私有源码来绕过上游依赖。
- 浏览器扩展不进入本仓库。

## 产品与安全底线

- 系统权限、用户拒绝、设备状态和平台限制高于远程命令。
- Android 远控须由用户在已解锁手机上开启在线会话。可勾选 App 授权五分钟，也可明确开启「全部可控 App · 不限时」，固定当时的候选包名。仅后者允许远程列出获准 App、请求打开其普通桌面入口。窗口操作仅限获准 App 的活动窗口，截图限 Android 14+ 单窗口。两种授权均不持久化。禁止远程开启、离线补执行、整屏回退或提供旧版 shell 命令。
- 不实现隐藏录音、隐藏拍摄、绕过锁屏、后台常驻监控或任意 App UI 自动化。
- SK、设备私钥、push token 等凭证只进入系统安全存储，不进 AsyncStorage、日志、崩溃报告或仓库。
- 高风险能力默认拒绝；每个能力必须声明 effect、确认策略、前台/后台条件和平台支持。
- 日志默认只记元数据；照片、位置、联系人和消息正文不得进入普通日志。

## 工程规则

- 包管理器使用仓库锁定的 pnpm，不混用 npm/yarn。
- Android 以 `native-android/` 的独立 Gradle 工程为准，使用 Kotlin 和原生 Views；APK 不依赖 RN、Expo 或 Metro。iOS 继续使用 TypeScript、React Native 与 Expo development build/prebuild，需要平台 API 时优先使用成熟 Expo 模块。
- 对外分发的原生 Android Preview 使用独立包名与项目私有发布签名。旧 Expo Preview 和数据保留在原包；核验 APK 包名与签名者后才可发布。
- 任何新依赖都要说明用途、维护状态、平台支持和为什么已有依赖不能满足。
- 原生能力必须提供 capability probe，不能只用 OS 名称推断可用性。

## 验证

- 文档阶段：`pnpm verify` 全绿。
- App 代码阶段：`pnpm verify` 至少覆盖 typecheck、lint、unit、协议契约测试。
- 改原生代码或权限配置：Android 与 iOS 构建都要过；平台专有代码至少过对应平台构建。
- Android 另跑 `pnpm test:android` 与对应 Gradle 构建。两种远控授权、应用列表与启动、跨窗口拒绝、会话撤销及单窗口截图须按 `llmdoc/delivery/definition-of-done.mdx` 留下适用 Android 真机证据。
- 改 push、相机、音频、后台任务或深链：模拟器不足以验收，必须按
  `llmdoc/delivery/definition-of-done.mdx` 留下真机证据。
- 测试失败或未执行必须明确报告，不能用文字宣称替代验证结果。

## 提交与 PR

- 小步提交，提交信息写清“为什么”和安全/平台取舍。
- PR 必须列出：能力变化、权限变化、平台差异、验证证据、回滚方式和文档更新。
- 新增或改变公开能力时，同一 PR 更新根 README、对应 `llmdoc/capabilities/` 文档、集成边界和 DOD 条目。
