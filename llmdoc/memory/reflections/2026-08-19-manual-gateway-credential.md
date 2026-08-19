# 手工 Gateway credential fallback 反思

## 任务

在正式 pairing 尚未交付时，让同一个安装包可由用户在本机输入 Gateway HTTPS origin 与 API key，
直接驱动已经接入的 `@tool-bridge/sdk/device` 前台 transport。

## 容易遗漏的约束

用户只希望输入 URL + API key，但 SDK 仍强制要求稳定 `deviceId`。若悄悄把 `installationId` 直接称为
gateway deviceId，会把客户端标识与网关签发身份混为一谈。当前做法从随机 installation UUID 派生独立
`mobile_<uuid>`，并在 UI/文档中称为客户端声明的 SDK deviceId；它只解决稳定路由，不提供签发、scope、
rotation 或 revoke 证明。

另一个风险是把 URL 与 secret 都当作普通配置。URL 可公开，但 API key 必须只进入 SecureStore；保存
时如果先覆盖 key、后关闭旧连接，旧 transport 的重连可能在 audience 切换窗口读到新 secret。清除时如果
先删 key、但旧连接仍存活，也不能证明远程会话已经停止。因此配置变更本身需要明确的副作用顺序。

## 有效做法

- 输入只接受 canonical HTTPS origin，以及无空白的 printable ASCII token；不静默 trim secret；
- 表单使用遮蔽输入，保存成功后立即清空，snapshot、日志、SQLite、审计和 accessibility announcement
  都不携带 API key；
- 保存严格按“停止旧 transport -> SecureStore save -> 连接新 audience”；
- 清除严格按“停止 transport -> SecureStore clear -> 恢复可选 build origin”；
- SecureStore save/clear 失败时保持 transport 关闭，不能为了 UX 回退到未知状态的旧 key；
- 把顺序抽成独立 controller，用事件序列测试成功和失败分支，而不是只靠 UI component test；
- 手工配置优先于非秘密构建 URL，但任何 `EXPO_PUBLIC_*` 都不得携带 secret。

## 证据边界

本地 schema、SecureStore facade、transport 切换、component 与 fake WebSocket 测试只能证明移动端
fallback 的安全边界。它不证明 API key 对真实 gateway 有效、权限足够小、服务端接受派生 deviceId，
也不完成 pairing、短期 ticket、真实 revoke 或真机 WebSocket header 验收。

## 提升到稳定知识

- 新增 `reference/manual-gateway-configuration.md` 固化输入、身份、存储、切换顺序和证据边界；
- 更新 SDK transport、安全边界、运行时架构与 upstream blocker，明确 fallback 不关闭 U-2/U-3。
