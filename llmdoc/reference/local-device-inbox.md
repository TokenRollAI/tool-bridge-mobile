# 设备本地信箱参考

## 定义与边界

`phone/inbox.deliver` 是面向用户的设备本地内容信箱。只有现有 SDK direct-call session 在线、调用已到达
`LocalCommandExecutor` 并通过本地安全链后，消息才会写入本机 SQLite；descriptor 的 queue policy 是
`reject_offline`。

这里的“信箱”不等于 U-5 gateway command mailbox：本地信箱没有 enqueue、claim/lease、cancel/expiry、
result cursor 或离线拉取状态机，也不注册 APNs/FCM token。设备离线、App 被挂起或进程终止时，当前实现
不会自行收件或用 push 唤醒。U-5/U-6 仍由上游协议与 gateway 拥有。

## `phone/inbox.deliver` 契约

输入是 strict object：

- `title`：trim 后 1–120 个单行安全显示字符；
- `body`：把 CRLF/CR 规范为 LF 并 trim，规范化后 1–4,000 个字符，内容格式为 Markdown；
- `category`：`message | subscription | news | update`，默认 `message`；
- `format`：当前只接受 `markdown`，默认 `markdown`；
- `urgency`：`low | normal | high | critical`，默认 `normal`；
- `sentAt`：可选；非空时必须是有效且可往返验证的 `YYYY-MM-DDTHH:mm:ss.sssZ` canonical UTC；
- `sourceLabel`：可选，trim 后 1–120 个单行安全显示字符；
- `notify`：boolean，默认 `false`。

`title`、`body`、`sourceLabel` 拒绝不允许的 C0/C1 control 与 bidi override/isolate；unknown field 一律
拒绝。caller 不能提供顶层 URL/action、data、sound、badge、channel 或认证身份；Markdown 图片 URL
只是受限内容引用，必须经过逐图显式点击和有界 URL/content policy。`sourceLabel` 只是 Agent
提供的内容标签；`urgency` 与 `sentAt` 也只是 Agent 提供的内容元数据。
`callerSubjectId/callerDisplayName` 只来自 invocation context。

descriptor 是 `effect: write`、`risk: medium`、`confirmation: never`、每 caller 30/全局 60 次每小时、
inline result 最大 2 KiB。`confirmation: never` 只表示 capability 不额外强制确认；全局
`ask_every_time` 仍会因 write effect 请求本地确认，且确认详情只含 title、category、urgency 和是否请求提醒，
不含 body。

成功输出固定为：

```text
{
  status: "stored",
  messageId,
  receivedAt,
  notification
}
```

`notification` 是以下互斥状态之一：

- `not_requested`：`notify: false`；
- `not_attempted`：消息已落盘，但提醒前因取消或 command 到期而不再尝试；
- `permission_required`：现有授权仍可由用户在本地请求；远程调用不会发起权限请求；
- `unavailable`：权限永久拒绝、channel 关闭或平台当前不可用；
- `status_unknown`：授权/调度超时或异常，或原生返回的 identifier 不可信；
- `scheduled`：同时返回确定性 `notificationId`，只表示原生 schedule Promise 返回受信 identifier。

`scheduled` 不表示 presented、delivered、clicked、read 或 on-time；其余提醒状态也不改变 `stored`。

## SQLite v4、时间事实与内容所有权

SQLite schema v4 重建专用 `inbox_messages` 表并保留 v3 内容：

- `message_id` 是主键，值为 `inbox_ + lowercase SHA-256(commandId)`；
- `source_command_id` 是 `UNIQUE NOT NULL` 幂等键；
- 表内保存 invocation caller、category、可选 source label、title/body、format、urgency、可空 sent/read 时间
  与 received 时间；
- v3 旧行迁移为 `format = markdown`、`urgency = normal`、`sent_at = NULL`；普通文本本身是合法 Markdown，
  未知的 Agent 发送时间不会用本机收件时间补造；
- insert-or-ignore、按 source command 回读和 retention prune 在同一 exclusive transaction 内完成；
- 每次写入维持全部消息 1,000 条硬上限，按 `received_at, message_id` 删除最老项，并保护本次写入项；
- migration 建立 received、sent 与 unread 查询索引，schema version 更新为 4。

`receivedAt` 是 controller 在本机 commit 时生成的事实；`sentAt` 是 Agent 可选提供的元数据。UI 将两者
分开展示，空 `sentAt` 不显示。“发送时间”排序对缺值使用 `COALESCE(sent_at, received_at)` 取得确定顺序，
但 fallback 只用于排序，不能写回 `sent_at` 或展示成 Agent 发送时间。

title/body/sourceLabel/urgency/sentAt 是独立的用户内容域，只进入 `inbox_messages`。它们不能进入 command
outcome、普通 `audit_records`、普通日志、自动 accessibility announcement 或系统通知 payload。command
outcome 只保存 message id、本机收到时间和提醒尝试状态。

## 全保留集检索、排序与已读

- search query trim 后最多 120 字符；repository 在全部最多 1,000 条保留行上用参数化 `LIKE ... ESCAPE '!'
  COLLATE NOCASE` 查询 title、body、sourceLabel、caller display name 与 caller subject id，先过滤和排序，
  最后最多投影 100 条。`!`、`%`、`_` 会转义，不把用户字符串拼成 SQL。
- 排序只能来自本地六值枚举：`received_desc`、`received_asc`、`sent_desc`、`sent_asc`、
  `unread_first`、`read_first`。收件/发送时间用 message id 确定性打破平局；未读/已读优先组内按收件时间
  倒序。
- 默认是空搜索 + `received_desc`。输入搜索词不会逐键触发查询，用户须按键盘 search 或“搜索”按钮明确
  提交；搜索与排序是进程内 view option，不写入 SQLite。“最近半小时”只按当前最多 100 条结果的
  `receivedAt` 计算展示计数，不是 retention 或投递时限。
- 单条 mark-read 只更新仍未读的目标；mark-all 对表内全部保留消息执行，不受当前搜索或 100 条投影限制，
  并返回 SQLite 实际 changes。全局未读数也查询整个表。

## Markdown 与图片加载

`markdown-it/browser@15.0.0` 只负责产生 token，并配置 `html: false`、`linkify: false`、
`typographer: false`、`maxNesting: 20`。`SafeMarkdown` 不使用 WebView，而是显式投影标题、段落、列表、
引用、强调/删除线、行内/块代码、分隔线、链接文字和图片占位到 React Native `Text/View/Image`；链接不
成为自动导航入口，raw HTML 只作为文字，未知 token 不能获得任意组件或属性。

- 每条最多渲染 600 个 block + inline token；超限时降级为可选择的纯文本 Markdown。
- 列表默认只展示三行去标记纯文本摘要；页面一次只展开一条消息。展开正文只生成图片 alt/hostname 与
  “加载图片”按钮，每条最多 4 张；列表、搜索、排序、摘要和仅展开 Markdown 都不发起图片网络请求。
- 只有用户点按具体图片后才调用 resolver；每次点按只授权该图片的一次受控出站请求及其有界 redirect 链，
  不形成 hostname 持久信任、不授权其他图片或自动预取，失败后重试也需要再次点按。
- 图片初始 URL 可以使用任意通过本地结构 policy 的 hostname：必须是标准端口 HTTPS，且无 userinfo、
  fragment 或 IP literal。不存在 `EXPO_PUBLIC_INBOX_IMAGE_HOSTS`、Expo `extra.inboxImageHosts` 或 runtime
  host set；media/link 的构建时 hostname allowlist 保持不变，既不授权也不限制信箱图片。
- resolver 使用 `credentials: omit`、`redirect: manual`，最多 3 次 redirect，并在请求每一跳前及 response
  最终 URL 后复核相同结构 policy；安全的跨 hostname HTTPS redirect 允许继续，且不要求第二次点击。
  总 timeout 20 秒。
- 只接受 PNG/JPEG，复核 Content-Type、字节签名与实际尺寸；声明和实际字节都受 3 MiB 上限约束，宽/高
  各不超过 4096，像素总数不超过 16 MP。
- 下载只写 App 私有 `tool-bridge-inbox-images` cache，React Native `Image` 只接收校验后的 `file://` URI；
  初始化会清理遗留项，失败、取消、组件解码错误或卸载都会释放对应文件。

该策略仍有明确剩余风险：点击前 UI 只展示初始 hostname，跨 hostname redirect 的最终 hostname 未向用户
再次展示或确认；URL policy 会拒绝 IP literal，但当前没有 DNS 解析后的 private/link-local/loopback
地址检查，不能阻止 DNS rebinding、公共 hostname 指向私网、captive portal 或代理改写。即使
`credentials: omit`，远端仍可能从 URL/query、源 IP 和请求时间获得跟踪信号；系统 TLS 校验也不代表域名
信誉或内容版权可信。因此只能称为“用户逐图点按后，对任意 policy-compliant HTTPS 图片做有界加载”，
不能称为“所有 HTTPS 图片都安全”或“Markdown 可自由自动加载网络图片”。

## commit 后的固定提醒

消息持久化是主操作和线性化点；只有 commit 成功后才 best-effort 读取现有通知授权并尝试即时本地调度。
授权读取与 schedule 分别受 5 秒本地上限约束，提醒失败、取消、到期或结果未知都不回滚消息。

提醒 identifier 是 `tb_local_inbox_ + lowercase SHA-256(commandId)`；native request 不接收正文，只使用固定：

- title：`Tool Bridge 信箱`；
- body：`收到一条 Agent 来信，请在 App 内查看。`；
- sound：关闭；
- Android channel：`tool_bridge_local_requests_v1`。

前台 notification handler 只允许精确的 inbox/notify/timer 确定性 identifier 形状；本地信箱提醒不获取
push token，不是 remote notification 或 U-6 wake hint。

## 已读、清空、replay 与 refresh

- `clear` 的唯一删除范围是 `DELETE FROM inbox_messages`，返回 SQLite 实际 changes。它不删除 commands、
  audit、timers、settings、installation identity 或 credential，也不取消 command、撤销 gateway、删除
  服务端数据或调用通知取消 API。
- command 防重放记录与内容生命周期分离。用户清空后，同一 `commandId` replay 返回原持久化终态，handler
  不再执行，因此不会重建已清空消息；crash 遗留 running command 恢复为 `result_unknown` 时也不重放写入。
- `ApplicationRuntime` 为 inbox 维护独立 revision。search/sort view option、clear、单条/全部 mark-read 以及
  成功 commit 的回调都会递增；refresh 捕获 revision，并在组合发布查询结果与全局未读数前复检，拒绝旧
  查询或写操作之前启动的迟到 snapshot。

## 证据分层

1. **本地自动化**：schema、migration、repository、controller、registry、component 与 local runtime
   contract 证明 strict rich schema、v4 migration、正文域、1,000 cap、全保留集参数化搜索、六种排序、
   单条/全部已读、确定性幂等、commit 后提醒、clear/replay、revision、RN Markdown 白名单、点击前零网络、
   任意结构合规 HTTPS、安全跨 hostname redirect、inbox hostname 配置链缺失且 media/link 配置未变；注入
   adapter/fake transport 不是系统或 gateway E2E。
2. **真实 Gateway wire**：尚无当前 Gateway 对 `inbox/deliver` 的联合验证。已有 Android
   `status/get` 真机结果不能替代新增 format/urgency/sentAt/Markdown 的 expose/call/result、duplicate id 与
   正文脱敏证据。
3. **平台与双端真机**：本次信箱变更尚无 Android/iOS 原生构建和双端真机验收；重启持久化、前后台、
   锁屏、Markdown 布局、长列表/搜索/排序、全部已读、图片真实下载/解码/取消/清理、跨 hostname redirect、
   代理/DNS rebinding/private network、内存/无障碍、权限/channel 变化与提醒呈现仍待验证。
4. **离线 mailbox + push**：U-5 enqueue/claim/cancel/expiry/result 与 U-6 token registration/opaque wake
   hint 尚未交付；离线、挂起、进程终止、未送达、弱网和 credential revoke 都没有端到端证据。

当前只能表述为：“设备在线且 direct call 已到达本地 executor 后，本机可安全保存并查询富内容消息；
图片需用户逐图点按后按本地 policy 有界加载，并可 best-effort 请求一条固定本地提醒。”不能表述为“Agent 可
随时给离线手机发信”“Markdown 图片必定显示”“后台必达”或“已实现 mailbox/push”。

## 事实真源

- `src/inbox/schema.ts`、`src/inbox/capability.ts`：strict schema、descriptor 与 result schema。
- `src/inbox/controller.ts`、`src/inbox/identifiers.ts`：commit/notify 顺序、状态与确定性 id。
- `src/storage/migrations/0003_inbox.ts`、`src/storage/migrations/0004_inbox_metadata.ts`、
  `src/storage/inboxRepository.ts`：SQLite v3→v4、幂等、retention、搜索/排序、read-all/clear。
- `src/inbox/imagePolicy.ts`、`src/inbox/imageSource.ts`、`src/inbox/expoInboxImageCacheStore.ts`：逐图点击后的
  HTTPS 结构 policy、有界解析、跨 hostname redirect 和私有 cache 生命周期。
- `src/runtime/applicationRuntime.ts`、`src/ui/screens/InboxScreen.tsx`、`src/ui/components/SafeMarkdown.tsx`：
  revision、查询/未读组合、摘要/展开与 RN Markdown 白名单。
- `app.config.ts`、`scripts/verify-app-config.mjs`：不存在 inbox image hostname extra/runtime 配置，media/link
  allowlist 仍保留。
- `src/capabilities/productivity/notificationAdapter.ts`：固定 native payload、授权与本地 identifier allowlist。
