# 文档缺口

以下是需要外部证据后补强的知识入口，不代表已承诺的时间表：

- 上游 pairing、ticket、caller/deadline、profile、mailbox、push、objectRef 发布后，需要把正式版本、
  schema/fixture 入口和兼容矩阵提升到 reference；device client 0.11.0 与 pairing 前手工 URL/API key
  fallback 已分别记录在 SDK transport 和 manual gateway reference。
- 获得真实 Gateway HTTPS origin/API key 后，需要补 hello/expose/call/cancel/result、权限拒绝、弱网重连
  与 secret 服务端兼容证据；当前 fake WebSocket 不能替代该矩阵。
- iOS simulator clean build 已有 macOS CI 记录；仍需 iOS 真机、签名 archive 与 generated
  entitlement/Info.plist 的正式发布核对。
- 双端真机矩阵执行后，需要按能力记录设备、OS、build id、权限/后台/锁屏条件和脱敏日志。
- `v0.0.1` tag 首次运行后，需要记录 release workflow、tag commit、Release asset URL 与 digest 的闭环证据。
- production release 仍缺 privacy manifest/商店数据声明、正式签名、安装 smoke、SBOM、rollout 与回滚证据。
