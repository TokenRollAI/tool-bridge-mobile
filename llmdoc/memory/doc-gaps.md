# 文档缺口

以下是需要外部证据后补强的知识入口，不代表已承诺的时间表：

- 上游 pairing、ticket、caller/deadline、profile、mailbox、push、objectRef 发布后，需要把正式版本、
  schema/fixture 入口和兼容矩阵提升到 reference；device client 0.11.0 与 pairing 前手工 URL/API key
  fallback 已分别记录在 SDK transport 和 manual gateway reference。
- 获得真实 Gateway HTTPS origin/API key 后，需要补 hello/expose/call/cancel/result、权限拒绝、弱网重连
  与 secret 服务端兼容证据；当前 fake WebSocket 不能替代该矩阵。
- 完整 Xcode 环境可用后，需要新增 iOS clean build 验证记录并核对 generated entitlement/Info.plist。
- 双端真机矩阵执行后，需要按能力记录设备、OS、build id、权限/后台/锁屏条件和脱敏日志。
- CI 首次从 clean checkout 运行后，需要记录 workflow run 与 artifact-to-commit 追溯证据。
- release 阶段仍缺 privacy manifest/商店数据声明、签名、安装 smoke、SBOM、rollout 与回滚证据。
