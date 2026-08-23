# 设备本地信箱富内容与检索扩展反思

## 任务

在既有 `phone/inbox.deliver` 本地内容信箱上增加 Markdown、紧急程度、可选 Agent 发送时间、图片安全加载、
全文搜索、固定排序、单条/全部已读和更紧凑的消息浏览交互，同时保持最初信箱切片的数据域、幂等、清除
与在线 direct-call 证据边界。

本次不是新增 gateway mailbox 协议，也没有改变“只有 call 已到达本地 executor 后才能保存”的前提。

## 关键修正与经验

### 1. `sentAt` 不能用 `receivedAt` 补造

`receivedAt` 是本机成功写入消息时记录的本地事实；`sentAt` 是 Agent 可选提供的内容元数据。两者即使在
多数在线调用中非常接近，也不能互相替代。若旧消息没有远端发送时间，把 `received_at` 回填为
`sent_at` 会把推断伪装成来源事实，并让 UI 的“Agent 提供”标签失真。

SQLite v4 兼容迁移因此做了明确修正：

- `sent_at` 保持可空，v3 旧行统一迁移为 `NULL`；UI 对空值不显示发送时间；
- 旧正文使用 `format = markdown`、`urgency = normal` 作为可解释的兼容默认值；普通文本本身也是合法
  Markdown，不需要改写旧正文；
- “按发送时间排序”可以用 `COALESCE(sent_at, received_at)` 为缺值行提供确定顺序，但这只是排序 fallback，
  不能写回字段或把 fallback 展示成 Agent 发送时间；
- 新调用的 `sentAt` 只接受可验证的 canonical UTC 字符串，仍在 UI 明标为 Agent 提供；`receivedAt` 继续由
  本机 controller 生成。

兼容迁移的目标不是让所有新列看起来都有值，而是保留哪些事实确实未知。

### 2. Markdown parser 不是渲染授权

远端 Markdown 是不可信内容。仅选择一个 parser 并关闭 HTML 仍不足以把任意 parser 输出交给 UI。实现把
解析和渲染分成两层：`markdown-it/browser` 负责产生 token，并关闭 raw HTML、linkify 和 typographer，
限制 nesting；`SafeMarkdown` 再把允许的标题、段落、列表、引用、强调、代码、分隔线和图片占位显式投影
为 React Native `Text` / `View` / `Image`。

这里的安全边界是原生白名单 renderer：不使用 WebView，不执行 HTML/JavaScript，不把 Markdown 链接变成
自动导航入口，也不让未知 token 获得任意组件或属性。token 总数和每条图片数还需要硬上限；超限内容应
降级为纯文本或省略额外图片，而不是让复杂输入无限消耗布局资源。

### 3. 图片展开前和点击前都应零网络

显示 Markdown 不等于授权获取其中的远端资源。默认摘要不解析/加载图片；展开正文只显示图片 alt、来源
hostname 和“加载图片”按钮。只有用户对具体图片主动点按后才能调用 resolver，因此查看列表、搜索、排序、
展开另一条消息和仅展开 Markdown 都不会产生图片网络请求。

图片路径不能复用媒体或链接 handoff 的信任配置。它使用独立的
`EXPO_PUBLIC_INBOX_IMAGE_HOSTS` 精确 hostname allowlist，并经独立 bounded resolver：标准端口 HTTPS、无
userinfo/fragment/IP literal、manual redirect 逐跳及最终 URL 复核、`credentials: omit`、redirect/timeout
上限、声明和实际 3 MiB 上限、PNG/JPEG MIME 与字节签名、4096 单边和 16 MP 像素边界。下载只进入 App
私有 cache；失败、取消、图片组件报错或卸载时释放文件，React Native `Image` 最终只接收校验后的
`file://` URI。

“用户点击”只是开始执行安全解析的授权，不是绕过 allowlist 和内容校验的授权。

### 4. 搜索必须先覆盖保留集，再限制显示集

信箱保留上限是 1,000 条，runtime snapshot 只展示最多 100 条。如果在 React Native 内对当前 snapshot
过滤，用户将永远搜不到较旧的 900 条，产品声称的“全文搜索”就是错误的。

正确顺序是 repository 在 SQLite 全部保留行上执行参数化 `WHERE`，覆盖 title、body、source label、caller
display name 和 caller subject id，再按本地枚举生成的固定排序 SQL 排序，最后 `LIMIT 100` 投影到 UI。
`LIKE` 的 `%`、`_` 与 escape 字符必须转义，搜索词长度也要有界；排序字段不能由用户字符串拼接。

同理，“全部未读”和“全部标为已读”都针对表内全部保留消息，而不是当前搜索结果或 100 条 snapshot。
repository 返回 SQLite 的真实 changes，使反馈描述已确认的数据库事实。

### 5. 默认摘要、一次展开一条与 revision 属于同一资源边界

列表默认只展示三行纯文本摘要，图片折叠为占位文字；完整 Markdown 必须由用户展开查看。页面只维护一个
`expandedMessageId`，展开新消息会收起上一条。这既降低长正文对滚动和无障碍导航的干扰，也把同时存在的
Markdown token、图片占位和潜在 cache 生命周期限制在一条消息内。

搜索/排序变更、单条已读、全部已读、clear 和新消息落盘都会改变列表、顺序或全局未读数。它们必须共享
独立于其他数据域的 inbox revision：操作开始前递增，异步 refresh 捕获 revision，并在组合发布查询结果
与全局未读数前复检。这样，旧搜索、旧排序或写操作前启动的 refresh 不能在稍后覆盖新 snapshot。

一次展开一条是 UI 局部状态，不应被写入 SQLite；全部已读则是表级写操作，不能只更新屏幕上的对象。

## 证据边界

本轮自动化可直接证明的范围包括：

- v3 到 v4 的迁移形状、旧 `sentAt = NULL`、新字段约束与索引；
- repository 的参数化搜索、固定枚举排序、全表全部已读及内存/SQLite 合同；
- Markdown 原生白名单投影、raw HTML 作为文本、图片数量上限，以及显式点击前 resolver 零调用；
- 独立图片 URL policy、redirect/credential/大小/MIME/签名/像素边界、私有 cache 与失败清理；
- UI 默认摘要、单一展开项、搜索显式提交、固定排序入口、单条/全部已读反馈和现有 clear 语义；
- local runtime 的 inbox revision、查询结果与全局未读数组合发布。

这些 unit/component/contract 和配置检查只证明本地实现边界。即使全量 `pnpm verify` 通过，也不等于：

- 当前真实 Gateway 已对 `phone/inbox.deliver` 的新增 schema、Markdown body、`sentAt`/`urgency` 与 result
  完成 Android/iOS wire 联合验证；既有 `status/get` 真机证据不能代替该 path；
- Android/iOS 原生构建和双端真机已经验证 Markdown 布局、长列表、搜索输入、排序、全部已读、App 重启
  持久化、图片真实下载/解码/取消/清理、前后台内存压力或无障碍行为；
- 本地通知已在双端真机覆盖权限、channel、前后台和锁屏呈现；
- U-5 gateway command mailbox 与 U-6 push 已提供离线 enqueue、唤醒、未送达、撤销或最终状态。

在这些证据补齐前，只能声称“在线 call 到达本地 executor 后，本机可安全保存并查询富内容消息；图片需
用户点按后 best-effort 安全加载”。不能声称离线手机可收信、Markdown 图片必定可显示、消息后台必达或
Gateway 已兼容本次扩展。

## 提升候选

- 在本地信箱稳定 reference 中固化 `sentAt` 与 `receivedAt` 的事实来源、v4 迁移默认值和 sent-sort
  fallback 仅用于排序的边界。
- 在安全文档中固化“parser 输出仍需原生白名单 renderer”“禁止 WebView”“图片点击前零网络”以及独立
  inbox image allowlist/resolver。
- 在信箱 repository/reference 中明确查询顺序是“1,000 条保留集上筛选与排序 -> 最多 100 条投影”，并
  区分当前结果与全局未读/全部已读。
- 把 view option、mark-read、mark-all、clear 和 insert 都纳入 inbox revision 的复用检查表。

## 后续

1. 在当前真实 Gateway 上执行包含 Markdown、可空/非空 `sentAt`、紧急程度和 duplicate command id 的
   Android 前台调用，核对 expose/call/result 与正文脱敏，再补 iOS。
2. 在双端真机用长正文、复杂列表、四张图片、超限/错误图片和 1,000 条种子数据验证布局、搜索、排序、
   已读、重启、取消、cache 清理与内存表现。
3. U-5/U-6 交付后仍使用独立 mailbox/push adapter；push 只提供 opaque wake hint，不携带 Markdown、图片
   URL、title、sourceLabel 或其他信箱正文元数据。
