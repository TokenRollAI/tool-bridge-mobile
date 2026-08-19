# 证据语言

## 必须区分的四层状态

1. **本地已实现**：代码与注入式 unit/component/contract 测试证明本地边界或状态机。
2. **Android 已构建**：clean Expo prebuild 后 Gradle 成功产出 debug APK，证明该工作树的 Android
   原生依赖与配置可编译；不证明设备行为。
3. **上游已集成**：只有使用上游发布的公共契约并通过 gateway wire/兼容测试后才能声称。
4. **平台已验收**：只有对应 iOS 构建、模拟器/仪器测试以及 DOD 要求的双端真机证据齐全后才能声称。

这些层级不能互相替代。尤其不能把 fake/injected adapter 的 contract test 写成网关端到端证据，
也不能把 generated native 配置写成后台、锁屏、DND、位置精度或音频中断已经在真机有效。

## 当前可用措辞

- 可写：`production transport 为 unconfigured`、`本地 executor 已实现持久化去重`、
  `Android clean debug build 已成功`。
- 需限定：`Android/iOS 已配置某权限或 background mode`，后接“尚无双端真机行为证据”。
- 不可写：`已配对`、`已在线`、`支持后台 push/mailbox`、`iOS 已构建`、`已通过真机验收`、
  `支持 objectRef`。

## DOD 勾选规则

- 组合条目必须满足全部条件；例如“allowlisted HTTPS/objectRef”不能因 HTTPS 部分完成就勾选。
- 自动化证据只勾选它直接证明的本地不变量，并在邻近文字注明证据上限。
- 测试未运行、失败、受环境阻塞或只在另一平台运行时必须明确报告。
- 发布、PR、真机、性能和上游兼容条目不能以说明文字代替证据。
