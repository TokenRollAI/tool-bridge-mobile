# 上游与平台阻塞参考

## 当前上游状态

U-1 已解阻：`@tool-bridge/sdk/device@0.11.0` 是正式 React Native / Hermes device client 入口，移动仓库
已消费官方 supervisor、frame/TBError、RN WebSocket header adapter 与 AppState lifecycle。精确用法与
证据边界见 `llmdoc/reference/sdk-device-transport.md` 和 `docs/SDK.md`。

仍未交付或未联合验收：

- U-2 pairing session、设备签发/重命名/轮换/撤销；
- U-3 单次短期 WebSocket ticket；当前原生 RN 使用既有 device SK header；
- device call 的 gateway-authenticated invocation context 与权威 createdAt/expiresAt/deadline；具体 Agent
  provenance 也尚未携带，但只影响审计/诊断，不是本地 trusted grant 的前置条件；
- U-4 动态 capability profile/version/change report；
- U-5 异步 command mailbox/claim/cancel/expiry/awaiting_user/result；
- U-6 APNs/FCM token registration 与不含敏感参数的 wake hint；
- U-7 绑定 device/command/MIME/大小/TTL 的 object upload 与受保护 `objectRef`；
- 真实 gateway compatibility matrix、CLI/管理入口与端到端 revoke。

因此可以声称“官方 SDK 前台 consumer wiring 已集成”，不能声称“已配对”“真实 gateway 已兼容”或
“后台可达”。用户现在可以在首页手工保存 HTTPS origin + API key 作为内测 fallback；它不提供设备
credential 的签发、最小 scope、rotation、revoke 或短期 ticket。没有 origin 为 `unconfigured`；有
origin 无 credential 为 `credentials_required`；只有收到真实 SDK ready 才是 online。

详细 U-1 至 U-7、验收条件与责任以 `docs/UPSTREAM.md` 为事实真源。

## 上游 tracking issue

- 已创建 [TokenRollAI/tool-bridge#68](https://github.com/TokenRollAI/tool-bridge/issues/68)（当前为 OPEN），
  统一跟踪 mobile-grade device control plane。
- issue 覆盖四组仍待上游交付的契约：gateway-authenticated invocation context/authoritative deadline、
  versioned dynamic capability profile、durable mailbox + opaque push wake hint，以及 command-bound protected
  `objectRef`。
- A 组对本地可信授权的最低需求是让调用可验证地绑定当前 Gateway Credential 实例并携带权威期限；
  具体 Agent provenance 可以作为可选审计元数据，不是 credential-bound trusted grant 的交付前置。
- issue 的创建只代表需求已进入上游跟踪，不代表任一契约已发布或已通过移动端联合验收；本仓库仍须按
  上述 U-2 至 U-7 状态和证据边界表述。

## 当前平台/环境阻塞

- Android debug APK 已 clean build，并有 API 36 emulator 安装/UI smoke；这些早于 SDK transport 接入，
  不能证明当前版本真机握手或 header 行为。
- Android/iOS production Metro 已能 bundle `/device@0.11.0`；Metro 不是原生 build 或真机连接证据。
- 本机缺完整 Xcode，iOS simulator build 未运行；不能因 prebuild/autolink/Metro 成功而勾选 iOS 构建。
- SDK transport 的 Android/iOS 真机 header、前后台、弱网、重连、系统挂起和长期稳定性尚未验收。
- 音频、位置、深链、权限、后台与锁屏按项目 DOD 需要双端真机；当前均未满足。
- push、mailbox、弱网/未送达、撤销后远端失效依赖上游和双端真机联合验证。
- local-only notification/timer 不实现 mailbox、push 或后台可达；timer 也没有 boot/exact 入口。
- release 签名、商店合规、可追溯 artifact、SBOM/审计与 rollout 尚未完成。

## 解阻后的验证顺序

1. 先以用户提供的真实 gateway HTTPS origin/API key 验证当前 fallback 的
   hello/expose/call/cancel/result、重复 id、拒绝和弱网重连；
2. U-2 pairing 产生真实、最小 scope credential，并验证 audience/rotation/revoke，替换手工长期 key；
3. 正式化 gateway-authenticated invocation context 与权威 deadline，证明 credential-bound grant 和 expiry
   不依赖客户端猜测；若携带 Agent provenance，再单独验证 Activity attribution；
4. 完成 Android/iOS clean build与双端真机前台连接；
5. 再接 U-5/U-6 mailbox/push 并验收后台、锁屏、未送达和撤销。

任一步未完成都要保留对应层级限定语。
