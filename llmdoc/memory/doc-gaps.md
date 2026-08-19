# 文档缺口

以下是需要外部证据后补强的知识入口，不代表已承诺的时间表：

- 上游 device client、pairing、ticket、profile、mailbox、push、objectRef 发布后，需要把正式版本、
  schema/fixture 入口和兼容矩阵提升到 reference。
- 完整 Xcode 环境可用后，需要新增 iOS clean build 验证记录并核对 generated entitlement/Info.plist。
- 双端真机矩阵执行后，需要按能力记录设备、OS、build id、权限/后台/锁屏条件和脱敏日志。
- CI 首次从 clean checkout 运行后，需要记录 workflow run 与 artifact-to-commit 追溯证据。
- release 阶段仍缺 privacy manifest/商店数据声明、签名、安装 smoke、SBOM、rollout 与回滚证据。
