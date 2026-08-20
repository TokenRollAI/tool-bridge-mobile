# 上游依赖与协作边界

Tool Bridge Mobile 的产品闭环需要 HTBP 和 `TokenRollAI/tool-bridge` 同步提供若干通用能力。
本文件是依赖清单，不代表对应上游已经实现。

## 0. 2026-08-19 复核结果

- npm 已发布 `@tool-bridge/sdk@0.11.0`，其独立 `/device` export 提供
  `connectDevice` 与 `createReactNativeWebSocketFactory`；本仓库已精确锁定并接入；
- U-1 以 `@tool-bridge/sdk/device` 而不是单独的 `@tool-bridge/device-client` 包名交付；Android/iOS
  Metro export 与移动 adapter contract 已通过；
- 原生 React Native 可以通过 WebSocket 第三个参数把既有 device SK 放在 Authorization header，
  因此“已有凭证 + 前台”的实时 transport 已不再受 Node runtime 阻塞；
- U-2 至 U-7 所需 pairing、短期 ticket、dynamic profile、mailbox、push 与 object upload 仍未交付；
  0.11.0 call 也没有具体 caller identity 或 gateway deadline；
- 移动 App 已提供手工 Gateway HTTPS origin + API key 内测 fallback；SDK deviceId 默认由设备硬件标识
  经单向摘要派生（可自定义），secret 只进 SecureStore。它不完成 U-2/U-3，也不冒充真实 gateway、
  pairing、最小权限
  credential、撤销或后台 wire contract；没有任何 URL 时仍显示 `unconfigured`。

## 1. 当前可复用

现有 Tool Bridge device 契约已经提供：

- `/system/device/ws?deviceId=...` 实时设备通道；
- `hello -> ready` 注册；
- `DeviceExpose.nodes[].cmds[]` 工具声明；
- `call -> result`；
- ping/pong；
- cancel 提示；
- call id 的进程内结果去重；
- 设备默认挂载到 `device/<deviceId>`；
- Tool Bridge 树、SK 和路径权限模型。

这足以做“App 在前台、已有设备 SK、只返回小 JSON”的最小协议实验，不足以安全发布移动产品。

当前移动仓库已把该实验做成显式本机 UI：用户输入纯 HTTPS origin 与 API key，App 用 RN WebSocket
Authorization header 建连。此 fallback 不新增 gateway endpoint 或 wire schema，但长期 API key 可能拥有
过大权限，因此不能从 U-2/U-3 清单移除 pairing、scope、rotation、revoke 与短期 ticket。

## 2. P0 上游硬依赖

以下依赖未完成前，移动仓库不能把相应能力标为 production ready。

### U-1：公共跨运行时 device client（已交付并消费）

所属：`TokenRollAI/tool-bridge`

交付事实：

- 包名/入口定为 `@tool-bridge/sdk/device@0.11.0`；
- 导出 frames/schema/types、`connectDevice`、credential provider、可注入 WebSocket factory 与连接
  lifecycle；
- React Native 子入口不导入 Node `ws` 或 `process.env`，包根仍是 Node 入口；
- 上游已有 fake transport 的 hello/ready/call/result、restart、suspend/resume、认证拒绝和 RN header
  测试；移动仓库已有 consumer contract 与双端 Metro 证据。

当前缺口不再记入 U-1：mailbox 属于 U-5；具体 caller/deadline 字段需单独扩展 device call contract；
真实 gateway compatibility matrix 仍是联合验收项。详细边界见 [SDK](SDK.md)。

### U-2：设备配对

所属：gateway + CLI/管理入口

需要：

- 创建一次性 pairing session；
- CLI 对等入口，例如 `tb device pair`；
- 查询、重命名、撤销设备；
- 签发只允许 device connect/mailbox/object 的最小凭证；
- pairing 审计；
- 二维码只是一种展示，不成为协议。

必须遵守 Tool Bridge “API、CLI、管理界面三入口对等”的现有原则。

### U-3：WebSocket ticket

所属：gateway

需要：

- 已认证设备用 HTTPS 换单次短期 ticket；
- ticket 绑定 deviceId/audience/nonce；
- gateway WebSocket endpoint 消费 ticket；
- query 日志脱敏；
- 重放、过期和设备不匹配测试；
- 保留 Node Authorization header 兼容期。

### U-4：设备动态 profile

所属：HTBP profile + gateway

需要：

- profile/version/observedAt；
- availability、confirmation、queue policy、platform/risk/limits 的正式字段；
- profile 变更上报；
- gateway 更新已挂载 node；
- 旧 Agent/SDK 对未知字段向后兼容；
- CLI 可查看设备当下能力与降级原因。

### U-5：异步 command mailbox

所属：gateway

需要：

- enqueue；
- list/pull；
- atomic claim/lease；
- awaiting_user/running/final 状态；
- result；
- cancel；
- expiration；
- idempotency；
- per-device ordered cursor；
- 调用方状态查询或事件订阅；
- 设备与 Agent 两侧权限隔离。

同步 HTBP call 如何映射到长时间等待命令需要正式决定：

- 短等待后返回 operation reference；或
- 原生异步 operation 语义。

不能让普通 HTTP 请求无限等待用户确认。

### U-6：push registration / dispatch

所属：gateway

当前移动端的 `phone/productivity.notify` 只是前台即时 local schedule：不获取或上传 APNs/FCM token，
不接 gateway/mailbox，也不把 `scheduled` 当作 provider delivery。仓库安装 `expo-notifications` 与本地
能力通过测试，均不能作为 U-6 已交付的证据。

同理，`phone/productivity.timer_*` 只是 SQLite + 系统本地 DATE trigger：它不提供 gateway 定时任务、
mailbox 唤醒、provider delivery 或跨设备 timer。Android reboot 后不会由本 App 的 boot receiver 恢复，
因为该权限/receiver 被刻意移除；这不构成 U-5/U-6 的部分交付。

需要：

- 设备注册/轮换/删除 APNs 和 FCM token；
- provider credential 独立 secret；
- payload 只含 opaque 提示；
- delivery attempt 和 provider error；
- invalid token 清理；
- rate limit 与 abuse protection；
- sandbox/production APNs 环境区分；
- capability kill switch。

### U-7：对象上传与读取

所属：gateway/object store

需要：

- 设备申请单次上传；
- 绑定 commandId/deviceId/MIME/max bytes/TTL；
- 直传对象存储；
- checksum/complete；
- 返回受保护 objectRef；
- Agent 读取继续经过 Tool Bridge 权限；
- 删除与生命周期；
- CLI 能查看 metadata/删除，不默认打印二进制。

## 3. P1 上游依赖

### U-8：设备事件

- profile changed；
- command state changed；
- attention stopped by user；
- playback state changed；
- upload completed/failed；
- credential revoked。

事件必须有权限、重放/游标和保留规则，不以“无限日志流”代替。

### U-9：策略模板

HTBP 定义可移植 policy descriptor，移动设备本地仍拥有最终裁决。策略签名和组织管理属于后续，
MVP 只需要用户本地模式。

### U-10：WebRTC session broker

P2 实时媒体需要会话信令、短期凭证、TURN 配置和显式终止；媒体不穿普通 HTBP JSON。

## 4. 移动仓库对上游的承诺

移动仓库必须提供：

- 每个新协议字段的真实移动用例；
- React Native fixture 和兼容测试；
- Android/iOS capability matrix；
- 后台、push、权限撤销和重放的真机证据；
- SDK 使用反馈；
- 不在上游正式化前制造事实标准；
- 上游 API 改动时同步更新本仓库文档和 adapter。

## 5. 不允许的临时捷径

- 把长期 SK 放 WebSocket URL；
- 把完整 command 放 push payload；
- 移动端轮询管理权限 API；
- 复制私有 `@tool-bridge/core` 源码后独立演进；
- 用 AsyncStorage 保存凭证或 command 去重状态；
- 用公开对象 URL绕过 Tool Bridge 读取权限；
- 为了后台实时性声称 push 必达；
- 在移动仓库私加 gateway endpoint 而无 CLI 和正式契约。

## 6. 推荐交付顺序

1. ~~U-1 公共 device client + 现有实时协议适配~~（0.11.0 已交付并由移动端消费）；
2. U-2 pairing + credential issuance/rotation/revoke，再完成 U-3 短期 WebSocket ticket；
3. Android 前台 `status` + `attention.ring` golden slice；
4. U-5 mailbox + U-6 push；
5. iOS 同场景与平台降级；
6. U-7 object upload；
7. 相机 golden slice；
8. profile/events 与更多能力。

这个顺序先验证身份、调用和用户控制，再加入后台和媒体，避免先做漂亮功能、后补安全根基。

## 7. 上游变更的完成条件

每项上游依赖至少要有：

- 正式 schema / 类型；
- gateway 实现；
- `tb` CLI 管理入口；
- SDK 公开入口；
- unit + wire contract + integration test；
- migration / compatibility 说明；
- 安全与日志检查；
- mobile consumer test；
- 发布版本和 changelog。
