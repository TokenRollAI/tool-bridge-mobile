# 上游与平台阻塞参考

## 当前上游状态

U-1 已解阻：`@tool-bridge/sdk/device@0.14.1` 是正式 React Native / Hermes device client 入口，移动仓库
已消费官方 supervisor、frame/TBError、RN WebSocket header adapter 与 AppState lifecycle。精确用法与
证据边界见 `llmdoc/reference/sdk-device-transport.md` 和 `docs/SDK.md`。

0.14.1 已交付命令叶子并入 `path` 的新 device call frame，以及网关签发的
`caller/createdAt/expiresAt/traceId` context。移动 adapter 已消费该 context 并对缺失情况明确降级；
该 context 不包含 device credential generation，不能单独完成未来的 credential-bound trusted grant。

仍未交付或未联合验收：

- U-2 pairing session、设备签发/重命名/轮换/撤销；
- U-3 单次短期 WebSocket ticket；当前原生 RN 使用既有 device SK header；
- 调用 context 与当前已认证 device credential/session 的可验证 identity/generation 绑定；
- U-4 动态 capability profile/version/change report；
- U-5 异步 command mailbox/claim/cancel/expiry/awaiting_user/result；
- U-6 APNs/FCM token registration 与不含敏感参数的 wake hint；
- U-7 绑定 device/command/MIME/大小/TTL 的 object upload 与受保护 `objectRef`；
- 真实 gateway compatibility matrix、CLI/管理入口与端到端 revoke。

因此可以声称“官方 SDK 前台 consumer wiring 已集成”，不能声称“已配对”“真实 gateway 已兼容”或
“后台可达”。用户现在可以在首页手工保存 HTTPS origin + API key 作为内测 fallback；它不提供设备
credential 的签发、最小 scope、rotation、revoke 或短期 ticket。没有 origin 为 `unconfigured`；有
origin 无 credential 为 `credentials_required`；只有收到真实 SDK ready 才是 online。

移动端已实现的 `phone/inbox.deliver` 是设备本地内容信箱：它复用现有在线 call/result，把已到达设备的
有界正文写入本机 SQLite，并可在 commit 后请求固定本地提醒。它没有 enqueue/claim/lease/cursor 状态机，
不获取 push token，也不会在设备离线或进程终止时自行收件，因此不构成 U-5/U-6 的部分交付。

详细 U-1 至 U-7、验收条件与责任以 `docs/UPSTREAM.md` 为事实真源。

## 上游 tracking issue

- 已创建 [TokenRollAI/tool-bridge#68](https://github.com/TokenRollAI/tool-bridge/issues/68)（当前为 OPEN），
  统一跟踪 mobile-grade device control plane。
- issue 中 invocation caller/权威期限的 wire 部分已由 0.14.1 交付；仍待上游交付的是
  Gateway Credential 实例/generation 绑定、versioned dynamic capability profile、durable mailbox +
  opaque push wake hint 与 command-bound protected `objectRef`。
- A 组剩余最低需求是让调用可验证地绑定当前 Gateway Credential 实例/generation；
  0.14.1 `caller.keyId` 是本次调用所用 SK id，不是这一 binding 的替代。
- issue 的创建只代表需求已进入上游跟踪，不代表任一契约已发布或已通过移动端联合验收；本仓库仍须按
  上述 U-2 至 U-7 状态和证据边界表述。

## 当前平台/环境阻塞

- Android Preview 0.0.6 已 clean build，保数据覆盖安装到物理设备，并完成当前 Railway
  Gateway 的单次 `status/get` 真机直连读调用；该证据只覆盖 Android/当前路径。
- 0.14.1 的 Android release Hermes bundle 与 iOS production Metro/Hermes export 均已重跑成功；
  iOS export 仍不是 iOS 原生 build 或真机连接证据。
- 本机缺完整 Xcode，iOS simulator build 未运行；不能因 prebuild/autolink/Metro 成功而勾选 iOS 构建。
- 除 Android 前台 `status/get` 外，SDK transport 的其他真机能力、iOS、前后台转换、弱网、
  重连、系统挂起和长期稳定性尚未验收。
- 音频、位置、深链、权限、后台与锁屏按项目 DOD 需要双端真机；当前均未满足。
- push、mailbox、弱网/未送达、撤销后远端失效依赖上游和双端真机联合验证。
- local inbox/notification/timer 不实现 mailbox、push 或后台可达；timer 也没有 boot/exact 入口。
- `phone/inbox.deliver` 目前只有本地自动化边界；尚无真实 Gateway path、Android/iOS 对应原生构建与
  双端真机前后台/锁屏/通知证据。Android `status/get` 真机结果不能替代它。
- release 签名、商店合规、可追溯 artifact、SBOM/审计与 rollout 尚未完成。

## 解阻后的验证顺序

1. 先以用户提供的真实 gateway HTTPS origin/API key 验证当前 fallback 的
   hello/expose/call/cancel/result、重复 id、拒绝和弱网重连；
2. U-2 pairing 产生真实、最小 scope credential，并验证 audience/rotation/revoke，替换手工长期 key；
3. 用 0.14.1 正式 invocation context 验证 caller attribution 与权威 expiry，再等待 Gateway
   Credential 实例/generation 绑定后验证 credential-bound grant；
4. 完成 Android/iOS clean build与双端真机前台连接；
5. 单独验证当前 Gateway 的 `inbox/deliver` 和双端真机本地保存/固定提醒，不从 `status/get` 外推；
6. 再接 U-5/U-6 mailbox/push 并验收离线、后台、锁屏、未送达和撤销。

任一步未完成都要保留对应层级限定语。
