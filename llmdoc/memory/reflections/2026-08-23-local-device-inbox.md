# 设备本地信箱反思

## 任务

为移动端增加 `phone/inbox.deliver`：Agent 在设备在线、现有 direct-call session 已到达本地 executor 的
前提下，把订阅摘要、新闻或任务更新保存到手机本地信箱；App 展示最近消息、未读状态与最近半小时分组，
并可在消息落盘后尝试发送一条不含正文的本地提醒。

## 预期与实际边界

用户说的“信箱”是面向人的内容收件箱，而项目和上游文档中的 `mailbox` 已特指 U-5 gateway command
mailbox。两者名称相近但所有权和可靠性语义完全不同：

- 设备本地内容信箱由本仓库拥有，入口是 `phone/inbox.deliver`，真源是本机
  `inbox_messages`；它只处理已经通过在线 direct call 到达设备的内容。
- U-5 command mailbox 由上游 gateway/协议拥有，需要 enqueue、claim/lease、cancel/expiry、结果和 cursor
  等状态机；设备离线、App 被挂起或进程终止时的投递属于这个边界。

因此本地功能不能复用 `mailbox` 作为协议或存储命名，也不能因 UI 上出现“信箱”就宣称具备离线排队、
后台可达或最终送达能力。中文产品名可以叫“信箱”，但代码、能力说明和 DOD 必须持续写清
`local device inbox != gateway command mailbox`。

## 关键经验

### 1. 正文需要独立的数据域

信箱的产品价值就是保存正文，不能沿用“普通审计只记元数据”的模型，也不能为了省表而把正文塞进
`commands.outcome`、`audit_records` 或 notification payload。实现使用专用 SQLite v3
`inbox_messages` 表保存有界 `title/body/sourceLabel`，command outcome 只返回 message id、接收时间和
通知尝试状态，普通 audit 仍只记录脱敏元数据，系统通知只使用固定标题与固定提示。

这也明确了不同存储的生命周期：内容信箱可由用户单独清空，审计用于解释调用，command 终态用于防重放，
三者不能因为都与一次调用相关而合并。Agent 提供的 `sourceLabel` 只是内容标签；认证 caller 仍只能来自
invocation context。

### 2. 先 commit，再做 best-effort 通知

“收到消息”和“系统愿意调度提醒”是两个不同事实。持久化消息是主操作，必须先在事务中完成 insert、
确定性去重和 retention prune；之后才读取已有通知授权并尝试固定内容的本地 schedule。远程调用不能在
这个路径请求权限，未授权、超时、取消/过期、原生异常或返回值不可信只影响 notification 子结果，不能
回滚已经提交的消息。

这条顺序让 `stored` 有清晰线性化点，也避免把通知系统当成内容存储。`scheduled` 仍只表示原生调度
Promise 返回，不表示 presented、delivered、clicked 或 read。

### 3. 清空内容不能清掉防重放真相

清空按钮只删除 `inbox_messages`。尤其不能删除对应 `commands`：用户清空信箱后，同一 `commandId`
重放应返回既有终态而不再次执行 handler，也就不会把已清空内容重新建回来。否则“清空历史”会意外恢复
旧副作用的执行资格。

确认文案还应明确保留 command 防重放、audit、timer、设置、identity 与 credential；本地内容删除不等于
取消命令、网关撤销、服务端数据删除或完整隐私擦除。并发重复与 crash 后 `result_unknown` 也必须沿用
command runtime 的现有不重放语义，而不是在 inbox 层另造一套命令状态机。

### 4. refresh 需要单调 revision

信箱列表和未读计数由多个异步查询组合。如果 clear 或 mark-read 之前启动的 refresh 在写操作之后才返回，
旧 snapshot 会覆盖新状态。`ApplicationRuntime` 因此在 clear、mark-read 和成功落盘触发刷新时递增独立的
inbox revision；refresh 捕获 revision，发布前复检，不再依赖 Promise 的完成顺序。

这与 Activity clear 的 audit revision 是同一类线性化问题，但必须使用独立 revision，避免一个数据域的
更新无意义地替另一个数据域裁决快照。写操作完成后再主动 refresh，以数据库当前真相为准，而不是直接
在 UI 内猜测列表或未读数。

## 证据边界

本轮 migration、repository、controller、notification adapter、registry、component 与 local runtime
contract 的自动化证据，只能证明：在线 call 已到达本地 executor 后，strict schema、专用正文存储、
确定性幂等、commit 后提醒、清空范围、revision 和 UI 投影的本地边界。即使全量 `pnpm verify` 通过，
也不能把这些注入式/fake adapter 测试外推为 Gateway 或平台交付证据。

仍未完成的证据包括：

- 当前真实 Gateway 对 `phone/inbox.deliver` 的 Android/iOS device-call 联合验证；已有其他路径的
  `status/get` 真机结果不能代替该能力的 wire 证据；
- 本次变更对应的 Android/iOS 原生构建，以及双端真机上的前后台、锁屏、权限/channel 变化、通知呈现与
  App 重启后的本地持久化验收；
- U-5 gateway command mailbox 的离线 enqueue/claim/cancel/expiry/result，以及 U-6 APNs/FCM token
  注册和 opaque push wake hint；
- 离线、系统挂起、进程终止、push 未送达、弱网重连与 credential 撤销后的端到端状态。

在这些证据补齐前，只能表述为“设备在线且 direct call 到达本地 executor 后，可保存到本机信箱并
best-effort 请求固定本地提醒”，不能表述为“Agent 可随时给离线手机发信”“后台必达”或“已实现
mailbox/push”。

## 缺失文档或信号

- 产品和协议文档需要同时出现“设备本地内容信箱”与“U-5 gateway command mailbox”的对照定义；仅写
  `mailbox` 或“信箱”会让后续实现误把本地表当作上游离线队列。
- 新增可清除内容域时，需要固定检查删除集合、保留集合、replay 行为和 refresh 竞态；现有 Activity
  reflection 提供了模式，但不能自动证明 inbox 已正确套用。
- 新增通知用途时，需要重新审视正文出口和 native identifier allowlist；“复用现有通知 adapter”不代表
  可以复用现有通知正文或把 delivery 语义升级。

## 提升候选

- 在稳定 reference 中固化 `phone/inbox.deliver` 的 schema、专用存储、结果语义、retention、清除范围与
  `local inbox != U-5 mailbox` 边界。
- 在 command/runtime 架构中加入“内容域可清除、command 防重放不可随之清除”的跨域不变量，以及
  commit 后 best-effort 外部提示的顺序。
- 在证据指南中把“在线到达后的本地内容保存”与“真实 Gateway wire”“双端真机”“离线 mailbox + push”
  分成独立验收层级。

## 后续

1. 用当前真实 Gateway 对 `inbox/deliver` 做最小 Android 前台在线调用，核对 path/context、结果 schema、
   duplicate command 和正文不进入普通日志；再单独补 iOS。
2. 在双端真机验证本地保存、重启持久化、首次/拒绝/关闭 channel 的提醒降级，以及前后台和锁屏显示。
3. 等上游 U-5/U-6 正式契约发布后新增独立 mailbox/push adapter；不要把它塞进
   `InboxDeliveryController`，也不要让 push payload 携带 title/body/sourceLabel。
