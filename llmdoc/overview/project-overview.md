# 项目概览

## 解决的问题

项目把手机状态、attention、媒体、位置、设备本地信箱及后续相机/提醒等能力，以可发现、可授权、可取消、可审计的
Tool Bridge 节点提供给 Agent，同时保留设备本地的最终裁决权。

## 边界

- 移动仓库负责 App、设备 runtime、本地策略、安全存储、持久化、UI 和平台能力 adapter。
- HTBP 与 `TokenRollAI/tool-bridge` 负责通用协议、gateway、pairing、公共 device client、mailbox、
  push registration/dispatch、动态 profile 和 object upload。
- 移动端可以维护本地归一化 command 模型与 fake adapter 测试，但不能把它们发布成第二套 wire 标准。

## 当前主要区域

- `app/`、`src/ui/`：Expo Router 页面、状态/确认/媒体控制、设备本地信箱，以及最近本地调用的 Activity
  投影与仅审计历史清除入口；共享组件提供页面/卡片/状态行/操作的 accessibility semantics 基线。
- `src/runtime/`：App 生命周期、执行器和本地撤销协调。
- `src/gateway/`：`@tool-bridge/sdk/device@0.14.1` transport、SecureStore credential provider、
  首页手工 HTTPS origin/API key 内测配置、AppState lifecycle 与 SDK call → 本地 command adapter。
- `src/policy/`：逐命令 policy 与内存确认队列。
- `src/storage/`、`src/identity/`：SQLite command/audit/control mode/timer 与 1,000 条硬上限的 SQLite v4
  inbox Markdown 内容域，以及 SecureStore identity/credential；command 每次完成时在同一 transaction 内维持 10,000 条
  终态总 cap。
- `src/capabilities/`、`src/inbox/`：status、attention、media、bounded apps handoff、foreground current
  location、structured map handoff、在线 direct-call 设备本地信箱、local-only productivity notification 与
  App 内 best-effort timer。
- `modules/tool-bridge-attention/`：Android/iOS haptic capability probe 与执行模块。
- `test/contract/`：本地执行边界的注入式契约测试，不是 gateway wire 测试。

## 当前阶段

本地 runtime 可以显示 `disabled | unconfigured | offline | online` reachability、动态 probe 能力、处理本地 command、
进行必要确认并记录脱敏审计。在线 direct call 到达 executor 后，`phone/inbox.deliver` 可把有界 Markdown
与 urgency/可选 sentAt 保存到 SQLite v4 专用表；搜索覆盖全部 1,000 条保留集，最多投影 100 条，支持六种
固定排序、单条/全部已读和单独清空。Markdown 由 React Native 白名单渲染，图片展开和点击前零网络，
逐图点按后才对任意结构合规的标准端口 HTTPS hostname 执行有界 resolver 并写入私有 cache；没有 inbox
image hostname 配置，media/link allowlist 保持不变。当前仍缺 DNS 私网/rebinding 防护，跨 hostname
redirect 的最终 host 也不会再次展示/确认；可选系统提醒只使用固定文案。
Activity 可解释最近 100 条本地调用，并在设备本地确认后只清除
`audit_records`；这不是完整数据删除或网关撤销。官方 SDK 前台 transport 已接入，用户可以在首页手工
保存 Gateway HTTPS origin 与 API key；secret 只进入 SecureStore，切换前先停止旧 transport。该入口是
pairing 前的内测 fallback，客户端派生的 deviceId 不是网关签发身份。只有真实 SDK ready 才显示 online；
0.14.1 已提供 gateway-authenticated caller 与权威 `createdAt/expiresAt`，移动 adapter 优先消费该
context，缺失时明确降级到 credential principal + 本地 30 秒期限。设备本地信箱不是 U-5 gateway command
mailbox；其真实 Gateway path、双端真机和离线 mailbox/push 证据尚未完成。pairing、完整 Gateway
compatibility matrix、后台 mailbox/push 和对象引用仍未验证或不存在。

## 文档关系

`docs/` 保存产品、目标架构、能力契约、DOD 和详细平台依据；`llmdoc/` 只保存供后续 Agent 快速进入
任务的高密度事实和路由，不复制整套产品文档。
