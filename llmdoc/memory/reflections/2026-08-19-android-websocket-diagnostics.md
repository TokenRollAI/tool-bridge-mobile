# Android WebSocket 连接诊断反思

## 任务

调查 Android 真机在 HTTPS 页面可访问、移动网络正常时仍长期 `reconnecting / transport_error` 的问题，
并在不泄露 Gateway credential 或原始网络异常的前提下，给移动端增加足够区分 DNS、TLS、连接超时与
WebSocket upgrade 失败的现场诊断。

## 容易误判的信号

- 仓库 `.env` 使用 `TB_BASE_URL / TB_REGISTRY_SK`，而 App build preset 只读取
  `EXPO_PUBLIC_GATEWAY_ORIGIN`，最初值得检查；但真机截图已经显示手工 origin、稳定 SDK deviceId 和
  `reconnecting`，所以它不是该次现场故障的当前根因。
- 手机浏览器能打开 HTTPS 页面只证明普通 HTTP/DNS/TLS 路径可用，不证明 RN/OkHttp WebSocket upgrade、
  Authorization header、SDK hello/ready 或 4 秒连接窗口可用。
- 单一 `transport_error` 丢弃了 RN `CloseEvent.reason/code`，导致网络、TLS、upgrade 和 SDK timeout 在 UI
  上不可区分。继续猜 VPN/Wi-Fi/5G 无法形成可复核证据。
- 测试曾假设 SDK 会在约 100ms 内创建第二条 raw socket；实际 supervisor 有重连退避。用例应显式驱动
  配置重建或控制计时器，不能把短轮询窗口当成协议承诺。

## 有效做法

- 分层排除：分别验证 Gateway HTTPS、无/有鉴权 WebSocket upgrade、真实 SDK hello/ready，以及真机 UI
  所处状态；不要把任一层的成功外推为全链路成功。
- 在交给官方 SDK 的 `DeviceWebSocketFactory` 外包一层 observer，保留 SDK supervisor 为唯一协议状态机；
  raw close 只投影为固定 `kind/stage/closeCode`。
- 原始 `reason` 只在当前调用栈内、最多 512 字符参与 allowlisted 分类，随后丢弃；URL、header、deviceId、
  reason 和 credential 都不进入 diagnostic、日志、审计或 UI。
- 用 logical connection revision、raw attempt ordinal 和本地主动 suppress 过滤旧连接迟到 close、后台
  suspend、配置切换、local revoke 与 credential invalidation；不能根据远端可伪造的 close reason 判断
  “主动关闭”。
- 保留最近一次失败诊断用于 reconnecting 现场观察，但新配置、unconfigured、credentials_required 和真正
  SDK `ready` 必须清除，避免把旧 audience/旧尝试误显示为当前故障。

## 证据与剩余缺口

分类、敏感 reason 丢弃、主动暂停抑制、旧连接隔离、ready 清理和首页固定字段已有 unit/component/fake
WebSocket 回归；本轮 `pnpm verify` 通过 53 suites / 232 tests。执行主机为 Node 26.7.0，而仓库锁定
Node 22.23.1，因此存在 engine warning，但 typecheck、lint、secret gate 和测试均通过。

本轮没有生成或安装新的 Android APK，也没有得到真机上的实际 `kind/stage/closeCode`。诊断代码只提升
下一次真机取证能力，不能据此声称故障已经修复、4 秒 timeout 已调整或真实 Gateway 长期兼容。

## 提升到稳定知识

- 更新 `reference/sdk-device-transport.md`，固化 raw WebSocket 诊断的状态、脱敏与生命周期边界。
- 在 llmdoc 索引中登记本反思，供后续 Android/iOS 连接、弱网和重连调查复用。
