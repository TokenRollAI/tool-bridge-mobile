# Android emulator 与最终权限验证反思

## 任务

把 Android development debug APK 从“clean build 成功”推进到可重复的 emulator 安装/UI smoke，并
验证最终安装包只保留当前能力需要的最小权限。

## 预期与实际

预期 `app.config.ts` 的 `blockedPermissions` 加 config introspection 足以证明权限收敛。实际安装 APK
后，`dumpsys package` 仍发现 Expo development 依赖引入的 biometric、legacy storage 和 debug overlay
权限；其中 debug manifest 的 `SYSTEM_ALERT_WINDOW` 还会在依赖移除后以更高优先级重新加入。

## 暴露的问题

- Expo config、generated manifest、merged manifest 与最终安装包是不同证据层；前一层通过不能推断
  后一层必然通过。
- dependency manifest 的移除规则不能覆盖 app 自己的 debug manifest；需要在 clean prebuild 时对
  生成的 debug manifest 做窄范围、可测试的 hardening。
- development client 首次启动多一层 Continue/Close UI；自动化如果假设直接进入 App 会不稳定。
- accessibility description 的子串匹配会把“能力”tab 误匹配到包含“远程能力”的紧急按钮；测试应
  使用完整语义或明确后缀。
- capability 列表的虚拟化/滚动会让标题与降级原因分处不同 viewport；断言需要等待实际文本进入树，
  不能用固定一次 swipe 猜位置。

## 处理方式

- `app.config.ts` 明确阻止 legacy storage、biometric 与 overlay 权限；配置校验对三个 variant 做
  introspection 断言。
- `plugins/withAndroidDevelopmentPermissionHardening.cjs` 只删除 generated debug manifest 中精确的
  `SYSTEM_ALERT_WINDOW` 声明，并用纯转换单元测试锁定行为。
- `scripts/verify-android-emulator.mjs` 从卸载 dev 包开始，安装正式 clean-build APK，以
  `dumpsys package` 验证最终权限，再执行首页、动态 capability、emergency disable 与 force-stop
  持久化 UI smoke。

## 已提升的稳定知识

- `guides/verification-and-claims.md` 现在要求 Android 权限结论同时具备 config introspection、merged
  manifest 与安装后 package 三层证据。
- `reference/verified-state-2026-08-19.md` 区分 clean build、emulator UI smoke、原生 instrumentation 与
  真机行为，不把它们合并成“平台已验收”。

## 后续

- 新增会改变 manifest 的 Expo/原生依赖时，重跑 clean build 和安装后权限 smoke，不能沿用旧 APK 摘要。
- 真机阶段需另行覆盖 haptic/音频、系统权限对话框、精度降级、后台/锁屏和运行中撤销；emulator 脚本
  只作为较低层的回归闸门。
- 若 CI 获得 emulator runner，可复用同一脚本，但仍需保留唯一 emulator、Metro 可达和 dev 包卸载范围
  这些前置条件。
