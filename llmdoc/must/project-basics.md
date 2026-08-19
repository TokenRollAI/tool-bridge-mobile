# 项目基本事实

## 身份

- `tool-bridge-mobile` 是 HTBP / Tool Bridge 生态的移动设备运行时，基于 React Native 与 Expo
  development build 面向 Android 和 iOS。
- 产品目标是让 Agent 在用户明确授权、系统权限和平台限制之内调用手机能力；它不是远程桌面、
  监控软件、MDM 或任意 App UI 自动化工具。
- 当前状态是“P0 本地安全运行时已实现若干纵向切片，尚未达到 MVP”，不能简称为已接通 Tool Bridge。

## 仓库所有权

本仓库拥有移动 App、移动端运行时、权限与确认 UI、本地持久化及必要的 Kotlin/Swift 原生模块。

本仓库不拥有 HTBP 通用协议、Tool Bridge 网关、跨运行时公共 SDK、command mailbox、对象存储或
浏览器扩展。缺失的通用能力必须在上游交付，不能复制 `@tool-bridge/core` 私有源码建立长期分叉。

## 工程基线

- 包管理器：pnpm，锁定版本见 `package.json`；禁止混用 npm/yarn。
- 运行环境：Expo development build / prebuild；Expo Go 不是验收环境。
- 通用逻辑优先 TypeScript；平台 API 优先成熟 Expo 模块，确有必要再使用 Expo Modules API。
- 三个环境使用不同 Android application id、iOS bundle id、scheme 与显示名称，但共用已绑定的
  `@tokenroll/tool-bridge` EAS project/slug；配置真源是 `app.config.ts`，构建 profile 真源是 `eas.json`。

## 继续阅读

- 产品和仓库全貌：`llmdoc/overview/project-overview.md`
- 当前证据快照：`llmdoc/reference/verified-state-2026-08-19.md`
