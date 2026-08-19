# 上游与平台阻塞参考

## 当前上游状态

U-1 已解阻：`@tool-bridge/sdk/device@0.11.0` 是正式 React Native / Hermes device client 入口，移动仓库
已消费官方 supervisor、frame/TBError、RN WebSocket header adapter 与 AppState lifecycle。精确用法与
证据边界见 `llmdoc/reference/sdk-device-transport.md` 和 `docs/SDK.md`。

仍未交付或未联合验收：

- U-2 pairing session、设备签发/重命名/轮换/撤销；
- U-3 单次短期 WebSocket ticket；当前原生 RN 使用既有 device SK header；
- device call 的具体 caller identity 与 gateway createdAt/expiresAt/deadline；
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
3. 正式化 caller/deadline，证明 Activity attribution、per-caller limits 和 expiry 不是本地替代值；
4. 完成 Android/iOS clean build与双端真机前台连接；
5. 再接 U-5/U-6 mailbox/push 并验收后台、锁屏、未送达和撤销。

任一步未完成都要保留对应层级限定语。
