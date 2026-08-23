# 信箱 Markdown 图片 HTTPS Policy 修正反思

## 任务与用户纠正

最初的富内容信箱实现要求 Markdown 图片 hostname 预先进入构建时
`EXPO_PUBLIC_INBOX_IMAGE_HOSTS` allowlist。用户明确纠正了这个产品边界：Agent 提供的 Markdown 图片
可以来自任意通过设备本地 URL policy 的 HTTPS 地址，不应要求每个来源先改环境变量并重新构建 App。

这不是把图片改成自动加载，也不是取消本地安全检查；变化只在 hostname 信任模型：从“构建时预授权一组
域名”改为“默认零网络，用户点按具体图片后，按请求逐次执行结构和内容 policy”。

## 为什么删除构建时 hostname 配置

构建时 allowlist 对媒体播放和 App handoff 仍有意义，因为这些能力会直接执行远端命令指定的来源或跳转。
信箱图片的交互不同：Markdown 先作为本机内容保存，图片只显示占位，用户可以看见原始 hostname 并决定
是否加载。要求预配置来源会造成三个问题：

- 订阅、新闻和 Agent 产出的图片域名不可预知；合法内容会因构建时未知 hostname 永久不可见；
- 每增加一个内容源都需要改 `.env` / Expo config 并重建，错误地把内容浏览策略变成发布配置；
- 留下一个名为 inbox image hosts 的空或未使用 runtime set，会让代码和文档继续暗示存在域名授权边界，
  形成幽灵配置和错误的 fail-closed 行为。

因此修正必须完整删除这条配置链，而不是只跳过一次检查：删除
`EXPO_PUBLIC_INBOX_IMAGE_HOSTS` 示例、`parseInboxImageHosts`、Expo `extra.inboxImageHosts`、runtime
`ExpoConfigHosts.read('inboxImageHosts')`、resolver 构造参数中的 host set，以及依赖该 set 的 policy/tests。
配置验证反向断言 `extra.inboxImageHosts` 不应存在，避免以后误把旧门槛带回来。

媒体和 App handoff 的 hostname allowlist 保持独立不变；它们既不授权信箱图片，也不应因本次修正被放宽。

## 新的授权与执行边界

### 1. 点击前零网络，点击只授权本次图片请求

消息列表默认显示纯文本摘要；展开 Markdown 后图片仍只是 alt、原始 hostname 和加载按钮。解析 Markdown、
搜索、排序、展开消息或滚动列表都不能调用 resolver。用户点按某一图片的加载按钮，才授权对该图片 URL
发起一次受控出站请求，并跟随 policy 允许的有界 redirect 链。

这个点击不是对 hostname 的持久信任，也不授权其他消息或同一消息中的其他图片，更不允许之后自动预取。
图片失败后的重试仍需再次点按。卸载/收起相关组件会中止进行中的 resolver 并释放已完成的私有 cache。

### 2. hostname 放宽不等于 URL 与内容 policy 放宽

初始 URL、每一个 redirect target 和最终 response URL 仍分别复核：

- 只接受标准端口 HTTPS；拒绝 HTTP、userinfo、fragment 和 IP literal；
- fetch 使用 `credentials: omit` 和 `redirect: manual`，最多 3 次 redirect，总操作默认最多 20 秒；
- 同时检查声明 `Content-Length` 和流式实际字节，默认上限 3 MiB；
- 只接受 PNG/JPEG 声明 MIME，并用字节签名和尺寸结构复核内容；
- 单边不超过 4096，像素总数不超过 16 MP；
- 数据只写入 App 私有 cache，React Native `Image` 只接收校验后的 `file://` URI；失败、取消、超限、
  解码错误和组件卸载都进入清理路径。

变化后的 policy 允许 `https://a.example/...` redirect 到 `https://b.example/...`，只要下一跳和最终 URL
分别满足相同结构约束。过去“跨 allowlist hostname redirect 必须拒绝”的断言已不再成立；现在应测试
“安全的跨 hostname HTTPS redirect 可继续，不安全的 HTTP/带凭证/非标准端口/IP 等下一跳在请求前拒绝”。

## 剩余风险与取舍

移除 hostname allowlist 明确扩大了 App 可主动连接的远端集合。现有边界降低资源消耗和内容解析风险，
但不证明任意 HTTPS hostname 值得信任：

- 图片 URL/query 可以携带唯一标识。即使 `credentials: omit` 不发送 cookie/HTTP credential，远端仍能看到
  IP、请求时间及网络栈提供的有限元数据，因此点按可能形成跟踪信号；
- UI 在点击前展示初始 hostname，但安全的跨 hostname redirect 不要求第二次确认。用户不一定看见最终
  hostname，这是支持常见 CDN redirect 与逐跳可见同意之间的明确取舍；
- policy 拒绝 IP literal，但当前没有 DNS 解析后的 private/link-local/loopback 网段检查，也不能消除 DNS
  rebinding、恶意公共 hostname 指向本地网络或 captive portal/企业代理行为；
- 系统 TLS 校验只能证明证书/连接满足平台规则，不代表域名信誉、图片内容来源或版权可信；
- 3 MiB、像素、token 和图片数量上限降低 DoS 面，但真实 decoder、设备内存压力、反复点按和并发加载仍需
  真机验证。

因此“允许任意 HTTPS hostname”必须始终与“用户逐图点按 + 本地 bounded policy”一起描述。不能缩写为
“Markdown 可自由加载网络图片”或“所有 HTTPS 图片都安全”。若后续需要更强隐私模式，可考虑在点击确认
中显示完整目标/redirect 变化、增加 private-network DNS/IP 防护或提供用户级总开关；这些都是后续提案，
不是当前实现事实。

## 证据边界

当前自动化可直接证明：

- URL policy 接受不同普通 HTTPS hostname，同时拒绝 HTTP、userinfo、fragment、非标准端口和 IP literal；
- resolver 允许安全的跨 hostname HTTPS redirect，并在请求每一跳前及最终响应后重新校验 URL；
- `credentials: omit`、manual redirect、redirect/timeout、声明/实际字节、MIME/签名、像素和 cache 清理路径
  由注入式 fetch/cache 测试覆盖；
- Markdown component 在用户点击前不调用 resolver；
- Expo config 不再暴露 `inboxImageHosts`，媒体和 handoff allowlist 仍保持原配置。

这些 unit/component/config 测试不能证明：

- Android/iOS 真机 fetch 对 cookies、TLS、redirect、abort、代理、DNS rebinding、private network 和 captive
  portal 的实际行为；
- 用户在真实屏幕阅读 hostname 后作出了充分理解的授权，或跨 hostname redirect 对用户足够透明；
- 真机上的 PNG/JPEG 解码、并发/重复加载、内存峰值、cache 回收和 App 前后台切换已经验收；
- 当前真实 Gateway 已兼容信箱 Markdown schema，或 U-5/U-6 mailbox/push 已交付。图片 policy 修正不改变
  信箱只能在在线 direct call 到达 executor 后保存的边界。

在补齐真机和 Gateway 证据前，只能声称“用户点按后，App 可对任意通过本地结构 policy 的 HTTPS 图片
执行有界加载”；不能声称任意远端图片已通过端到端安全验收或可离线/后台自动获取。

## 提升候选与后续

- 稳定安全文档应区分三种 URL 模型：media/link 的构建时 hostname allowlist、inbox image 的逐图点击 +
  任意 policy-compliant HTTPS、未来 objectRef 的上游受保护对象契约。
- 验证指南应把“零网络直到点击”“初始/逐跳/最终复核”“跨 hostname redirect 允许”列为同一组测试，
  防止只删 allowlist 却意外恢复自动加载或自动 redirect。
- 双端真机需要覆盖同 hostname 与跨 hostname redirect、恶意/超限图片、取消/重试/收起、代理和弱网；另行
  评估 DNS 解析后的私网地址防护与最终 hostname 可见性。
