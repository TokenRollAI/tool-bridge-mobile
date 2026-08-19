# 项目概览

## 解决的问题

项目把手机状态、attention、媒体、位置及后续相机/提醒等能力，以可发现、可授权、可取消、可审计的
Tool Bridge 节点提供给 Agent，同时保留设备本地的最终裁决权。

## 边界

- 移动仓库负责 App、设备 runtime、本地策略、安全存储、持久化、UI 和平台能力 adapter。
- HTBP 与 `TokenRollAI/tool-bridge` 负责通用协议、gateway、pairing、公共 device client、mailbox、
  push registration/dispatch、动态 profile 和 object upload。
- 移动端可以维护本地归一化 command 模型与 fake adapter 测试，但不能把它们发布成第二套 wire 标准。

## 当前主要区域

- `app/`、`src/ui/`：Expo Router 页面、状态/确认/媒体控制，以及最近本地调用的 Activity 投影与
  仅审计历史清除入口；共享组件提供页面/卡片/状态行/操作的 accessibility semantics 基线。
- `src/runtime/`：App 生命周期、执行器和本地撤销协调。
- `src/gateway/`：`@tool-bridge/sdk/device@0.11.0` 前台 transport、SecureStore credential provider、
  AppState lifecycle 与 SDK call → 本地 command adapter。
- `src/policy/`：逐命令 policy 与内存确认队列。
- `src/storage/`、`src/identity/`：SQLite command/audit/control mode 与 SecureStore identity/credential；
  command 每次完成时在同一 transaction 内维持 10,000 条终态总 cap。
- `src/capabilities/`：status、attention、media、bounded apps handoff、foreground current location、
  structured map handoff、local-only productivity notification 与 App 内 best-effort timer。
- `modules/tool-bridge-attention/`：Android/iOS haptic capability probe 与执行模块。
- `test/contract/`：本地执行边界的注入式契约测试，不是 gateway wire 测试。

## 当前阶段

本地 runtime 可以显示 `disabled | unconfigured | offline | online` reachability、动态 probe 能力、处理本地 command、
进行必要确认并记录脱敏审计。Activity 可解释最近 100 条本地调用，并在设备本地确认后只清除
`audit_records`；这不是完整数据删除或网关撤销。官方 SDK 前台 transport 已接入，但 fresh install
没有 pairing credential；只有真实 SDK ready 才显示 online。真实配对、gateway compatibility、caller/
deadline、后台 mailbox/push 和对象引用仍不存在。

## 文档关系

`docs/` 保存产品、目标架构、能力契约、DOD 和详细平台依据；`llmdoc/` 只保存供后续 Agent 快速进入
任务的高密度事实和路由，不复制整套产品文档。
