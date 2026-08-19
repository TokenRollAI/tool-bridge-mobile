# 验证与结论写作指南

## 1. 先按变更类型选择验证

- 文档或通用 TypeScript：至少运行 `pnpm verify`。
- Expo config、依赖或原生模块：除 `pnpm verify` 外，按 `docs/DOD.md` 执行对应 Android/iOS clean build。
- push、相机、音频、后台、深链、位置或权限：构建不足，必须按 DOD 留下双端真机证据。
- 协议/schema：必须使用上游正式 fixture 与 gateway/downstream 兼容测试；本地 fake contract 不替代。

使用 `package.json` 锁定的 Node/pnpm 和 `pnpm install --frozen-lockfile`。不要在失败或未执行时用文字宣称
“全绿”。

## 2. 核对配置与敏感边界

`pnpm verify` 当前串联文档链接、三环境/权限配置、原生模块、secret、license、依赖缓解、Expo 版本、
typecheck、lint 和 Jest。若变更触及生成的 native tree，确认 clean prebuild 后的 manifest/Info.plist 与
`app.config.ts` 一致，且没有提交证书、token、SDK 缓存或产物。

Android 权限变更需要同时检查三层：Expo config introspection、clean prebuild 的 merged manifest，以及
安装后的 `dumpsys package`。`blockedPermissions` 能移除依赖 manifest 声明，但 development debug
manifest 仍可能以更高优先级重新引入权限；不能只凭 config 输出作最终结论。

已有 debug APK、唯一且完成 boot 的 emulator 和运行中的 Metro 时，执行
`pnpm verify:android:emulator`。该脚本只操作 dev application id，并验证安装后权限、首页、动态能力和
紧急停用重启持久化；这属于 emulator UI smoke，不是原生 instrumentation 或真机证据。

要交付不依赖 Metro 的内部 Android 安装包，使用 `pnpm build:android:preview`，并验证 package 是
`ai.tokenroll.toolbridgemobile.preview`、APK 含 `assets/index.android.bundle`、签名可验证且显式
MainActivity 能冷启动。当前 release build 使用 debug test key，只能称为 preview/internal artifact；
远端 workflow 未成功前也不能把本地产物写成 CI artifact。

## 3. 写证据记录

记录命令、工具链版本、平台、build 类型、结果、产物摘要和明确未覆盖项。Android 当前范例见
`docs/verification/2026-08-19-android-debug.md`。

结论按以下格式分层：

- **已验证**：精确写出哪个命令/测试/构建证明了什么。
- **未验证**：列出 iOS、原生 instrumentation、真机、后台、锁屏、弱网、权限变化等未运行项。
- **受阻**：指出缺少的上游公共契约或本机工具链，不能改写成“后续优化”。

## 4. 同步文档

新增或改变公开能力时，同一变更同步 `README.md`、`docs/PRD.md`、`docs/CAPABILITIES.md`、
`docs/SDK.md`、`docs/DOD.md` 及相关安全/架构文档。只勾选证据直接覆盖的 DOD 子项，组合项不得拆词取巧。
