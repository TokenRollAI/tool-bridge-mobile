# 上游与平台阻塞参考

## 当前上游阻塞

截至 2026-08-19，npm 未发布可供 React Native production 使用的公共
`@tool-bridge/device-client`；现有 `@tool-bridge/sdk` 是 Node 入口。上游尚未交付以下正式公共契约：

- pairing session、设备签发/重命名/撤销；
- React Native 可安全使用的短期 WebSocket ticket；
- 动态 capability profile/version；
- 异步 command mailbox/claim/cancel/expiry/awaiting_user/result；
- APNs/FCM token registration 与不含敏感参数的 wake hint；
- 绑定 device/command/MIME/大小/TTL 的 object upload 与受保护 `objectRef`。

因此 production transport 必须保持 `unconfigured`。本地 command envelope、confirmation coordinator、
fake dispatcher 和 SQLite 状态都不是 gateway wire/mailbox 契约，不得通过命名相似宣称已集成。

详细 U-1 至 U-7、验收条件与上游责任以 `docs/UPSTREAM.md` 为事实真源；移动端接入约束和提案 API 见
`docs/SDK.md`，其中标注“提案”的示例不是当前可运行 SDK。

## 当前平台/环境阻塞

- Android debug APK 已 clean build，并有 API 36 emulator 安装/UI smoke；尚无 Android 原生
  instrumentation 或真机安装证据。
- 本机缺完整 Xcode，iOS simulator build 未运行；不能因 prebuild/autolink 成功而勾选 iOS 构建。
- 音频、位置、深链、权限、后台与锁屏按项目 DOD 需要双端真机；当前均未满足。
- push、mailbox、弱网/未送达、撤销后远端失效依赖上游和双端真机联合验证。
- `phone/productivity.notify` 只调度本地通知，且 final config 主动移除 APNs/FCM 入口；它不实现 U-5
  mailbox 或 U-6 push registration/dispatch，不能被用作后台可达证据。
- `phone/productivity.timer_*` 只维护 App 本地 SQLite 意图并调度 best-effort local notification；它不是
  gateway 定时任务、U-5 mailbox 或 U-6 push。当前也没有 boot/exact 入口，Doze、重启后 foreground
  reconcile、presentation 与准时性仍待双端真机验证。
- release 签名、商店合规、可追溯 artifact、SBOM/审计与 rollout 尚未完成。

## 解阻后的验证顺序

先以已发布的上游 schema/fixture 做 adapter 与 gateway wire contract，再完成 Android/iOS clean build，最后
按 DOD 在双端真机验证前台、后台、锁屏、权限拒绝/撤销、弱网和重复/过期命令。任何一步未完成都要保留
对应层级的限定语。
