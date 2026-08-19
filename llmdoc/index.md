# llmdoc 索引

## 用途

- 本目录压缩记录跨任务会反复使用的稳定项目知识；代码、正式协议和已发布 API 仍是事实真源。
- 每次进入仓库先读 `startup.md`，不要把 `.llmdoc-tmp/` 调查草稿当成稳定文档。

## 分类与文档

### 启动包

- `startup.md`：固定阅读顺序与按任务升级阅读提示。
- `must/project-basics.md`：产品身份、仓库边界和当前阶段。
- `must/safety-boundaries.md`：不可绕过的产品、安全与数据边界。
- `must/evidence-language.md`：如何区分本地实现、构建证据和未完成项。

### 项目概览

- `overview/project-overview.md`：项目目标、拥有范围、主要子系统及当前可用切片。

### 架构

- `architecture/local-command-runtime.md`：本地 command 执行顺序、持久化、确认与审计不变量。
- `architecture/capability-slices.md`：当前本地能力切片、原生边界及其证据上限。

### 工作指南

- `guides/verification-and-claims.md`：变更后选择验证命令并写出不夸大的结论。

### 参考

- `reference/verified-state-2026-08-19.md`：2026-08-19 工作树已经验证的基线快照。
- `reference/bounded-media-source.md`：受控 HTTPS 媒体的重定向、内容校验、字节上限与缓存生命周期。
- `reference/bounded-linking-handoffs.md`：`open_map` 与通用 App handoff 的结构化目标、bounded probe、
  commit 复检及结果脱敏。
- `reference/local-only-notifications.md`：`phone/productivity.notify` 的权限、固定系统内容、确定性标识、
  local-only 原生配置与结果语义。
- `reference/local-timers.md`：App 内 timer 的输入边界、SQLite 状态机、确定性调度、恢复/撤销竞态与
  best-effort 结果语义。
- `reference/local-activity-history.md`：Activity 本地审计投影、写时保留上限、仅审计清除范围、refresh
  竞态与 command replay 不变量。
- `reference/command-retention.md`：command 终态写入时的 10,000 总 cap、protected 候选、SQLite/内存
  等价边界与验证证据。
- `reference/accessibility-semantics.md`：共享 UI 语义、48dp、焦点/公告去重、对比度及 Android 200%
  字号 smoke 的证据上限。
- `reference/eas-project-binding.md`：单一 EAS project 身份、三变体隔离、profile/environment 与验证边界。
- `reference/manual-gateway-configuration.md`：手工 Gateway HTTPS origin/API key 的输入、身份、SecureStore、
  配置切换顺序与证据边界。
- `reference/sdk-device-transport.md`：官方 RN SDK 子入口、凭证/header、生命周期、raw WebSocket 脱敏诊断、
  call 归一化与证据边界。
- `reference/github-preview-release.md`：稳定 tag、版本真源、双端门禁、最小发布权限与内部 Preview 的
  production 证据边界。
- `reference/upstream-and-platform-blockers.md`：上游、iOS 和真机阻塞项及其事实真源。

### 过程记忆

- `memory/decisions/README.md`：llmdoc 决策记录的入口；正式 ADR 仍在 `docs/adr/`。
- `memory/doc-gaps.md`：已知知识缺口，不代表交付计划或承诺。

### 反思（与稳定文档分列）

- `memory/reflections/2026-08-19-local-runtime-bootstrap.md`：从目标文档到本地安全切片时的证据分层经验。
- `memory/reflections/2026-08-19-android-emulator-permissions.md`：从 Expo 权限配置到最终安装包与可重复
  emulator smoke 的验证经验。
- `memory/reflections/2026-08-19-command-boundary-races.md`：claim、confirmation、deadline、admission
  与 revoke 等异步边界的重复裁决经验。
- `memory/reflections/2026-08-19-bounded-media-resolution.md`：把远端 HTTPS 音频解析为有界本地文件时的
  信任边界与清理经验。
- `memory/reflections/2026-08-19-bounded-linking-handoffs.md`：把异步 `canOpenURL` 纳入 command deadline
  并用结构化地图目标消除 caller-controlled URI 的经验。
- `memory/reflections/2026-08-19-local-only-notifications.md`：收紧 Expo Notifications 默认远程入口、
  权限状态与 `scheduled` 证据语言的经验。
- `memory/reflections/2026-08-19-local-timer-reconciliation.md`：用持久化意图、command 终态和原生 pending
  集合协调 timer crash recovery、迟到 Promise 与 emergency revoke 的经验。
- `memory/reflections/2026-08-19-local-audit-history-clear.md`：分离可清审计投影与不可误删的防重放真相，
  并处理 DELETE/refresh 线性化边界的经验。
- `memory/reflections/2026-08-19-retention-and-accessibility-evidence.md`：避免把 protected command 误算为
  cap 外容量，并区分 UI 语义自动化与真实辅助技术验收的经验。
- `memory/reflections/2026-08-19-eas-project-binding.md`：从新版 Dashboard 缺少 UUID 展示到安全关联
  dynamic app config、多变体与证据边界的经验。
- `memory/reflections/2026-08-19-sdk-device-subpath-integration.md`：从 package 根假设转向 export/产物/Metro
  验证，并处理缺失 caller/deadline 的 transport 接入经验。
- `memory/reflections/2026-08-19-manual-gateway-credential.md`：在 pairing 前加入手工 API key fallback 时，
  分离 installation/device/caller 身份并保证 transport 与 SecureStore 切换顺序的经验。
- `memory/reflections/2026-08-19-android-websocket-diagnostics.md`：从浏览器可访问但 SDK 长期 reconnecting 的
  现场信号中分层排障，并把 raw close 压缩为不泄露凭证的固定诊断字段的经验。
- `memory/reflections/2026-08-19-github-preview-release.md`：统一版本真源、隔离 branch/tag 环境变量，并把
  自动内部发布与 production 资格分层的经验。
- `memory/reflections/2026-08-20-sdk-capability-completion.md`：从 RN Web API 差异、双向 expose schema、
  全局确认 modal、principal-scoped runtime control 与本地 attention sound 得出的能力交付经验。

## 路由规则

- 修改执行链、幂等、确认、撤销或审计前，读 `architecture/local-command-runtime.md`。
- 修改 attention、media、apps 或 location 前，读 `architecture/capability-slices.md`。
- 修改媒体下载、source policy、缓存或 player 输入前，额外读 `reference/bounded-media-source.md` 和
  bounded media reflection。
- 修改 `open_map`、`phone/apps` 或任何 `Linking.openURL` 路径前，额外读
  `reference/bounded-linking-handoffs.md` 和对应 reflection。
- 修改通知 capability、权限 UI、notification channel、Expo Notifications config 或原生 manifest 前，
  额外读 `reference/local-only-notifications.md` 和对应 reflection。
- 修改 timer schema、SQLite migration、调度/取消、启动恢复或 emergency disable 前，额外读
  `reference/local-timers.md` 和对应 reflection。
- 修改 Activity 页面、audit repository、retention、历史清除或 runtime refresh 前，额外读
  `reference/local-activity-history.md` 和对应 reflection。
- 修改 command complete/prune、terminal 保留数或 timer source 保护前，额外读
  `reference/command-retention.md` 和对应 reflection。
- 修改共享 UI component、tab 语义、焦点、公告或颜色主题前，额外读
  `reference/accessibility-semantics.md` 和对应 reflection。
- 修改 Expo owner/slug/projectId、EAS profile/environment、云构建或签名配置前，读
  `reference/eas-project-binding.md` 和对应 reflection。
- 修改 Gateway 设置、SecureStore credential、SDK transport origin 或鉴权 header 前，额外读
  `reference/manual-gateway-configuration.md` 和对应 reflection。
- 修改 App version/build number、release notes、tag workflow 或 GitHub Release 前，额外读
  `reference/github-preview-release.md` 和对应 reflection。
- 声称功能“完成”、勾选 DOD 或写 PR 证据前，读 `must/evidence-language.md` 和
  `guides/verification-and-claims.md`。
- 涉及 pairing、realtime、mailbox、push、objectRef 或 capability profile 时，先读
  `reference/sdk-device-transport.md` 和 `reference/upstream-and-platform-blockers.md`，再核实
  `docs/UPSTREAM.md` 与上游正式契约。
- 重复大范围 DOD/文档同步工作前，读本次 reflection，避免把目标态误写成现状。
