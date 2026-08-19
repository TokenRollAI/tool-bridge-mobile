# ADR-0002：锁定首个 App 脚手架与平台基线

- 状态：Accepted
- 日期：2026-08-19

## 背景

ADR-0001 决定采用 React Native + Expo development build，但没有锁定首个可构建脚手架的版本、
最低系统版本和环境标识。继续使用浮动版本会使 clean install、原生生成和双端构建证据不可复现。

## 决策

P0 首个脚手架锁定：

| 层 | 基线 |
| --- | --- |
| Node.js | `22.23.1` |
| pnpm | `11.21.0` |
| Expo SDK | `57.0.14` |
| React Native | `0.86.2` |
| React | `19.2.3` |
| TypeScript | `6.0.3`，`strict` |
| Android | min SDK 24（Android 7.0），compile/target SDK 36，Java 17 |
| iOS | deployment target 16.4，Xcode 26.4 或更高 |

使用 CNG：`android/` 和 `ios/` 由 `expo prebuild --clean` 生成并保持未跟踪。三环境标识为：

| 环境 | Android applicationId / iOS bundle id |
| --- | --- |
| development | `ai.tokenroll.toolbridgemobile.dev` |
| preview | `ai.tokenroll.toolbridgemobile.preview` |
| production | `ai.tokenroll.toolbridgemobile` |

三个安装变体共用 Expo/EAS 项目 `@tokenroll/tool-bridge` 与稳定 slug `tool-bridge`；Project ID 固定为
`378c7a3e-437a-49a6-ae20-fef5af6f6188`。EAS project/slug 只表示云端项目身份，不替代上述平台安装
标识隔离，也不代表 production transport 已配置。

production transport 在上游 device client、pairing 和 ticket 契约交付前保持 `unconfigured`；脚手架不得
自创 wire schema 绕过该闸门。

## 理由

- Expo SDK 57 与 React Native 0.86 提供当前受支持的新架构基线；
- Node 22 LTS 满足 Expo 工具链并与仓库上游 Node 生态一致；
- Android 24 和 iOS 16.4 是该脚手架实际生成、可由 CI 验证的最低版本；
- 精确版本、冻结 lockfile 和生成式原生工程共同降低不同开发机的漂移；
- 环境标识隔离避免 development/preview 构建覆盖 production App 或误连生产配置。
- 单一 EAS 项目配合独立 build environment 避免为每个安装变体复制项目级权限、构建记录与治理配置。

## 后果

- 依赖升级、最低系统版本变化或 CNG 策略变化必须更新本 ADR 或新增替代 ADR；
- Android/iOS 最低版本是工程支持边界，不等同于所有能力都在该版本可用；每项能力仍需实际 probe；
- 本机缺少 Java、完整 Xcode 或 CocoaPods时只能完成仓库级验证，原生 build 必须由具备对应工具链的
  runner 留下证据；
- Expo Go 不构成功能验收环境。

## 验证

- `pnpm install --frozen-lockfile`；
- `pnpm verify`；
- `APP_VARIANT=<variant> pnpm exec expo config --type public`；
- `pnpm --package=eas-cli@22.0.0 dlx eas project:info`；
- `pnpm --package=eas-cli@22.0.0 dlx eas config --platform android --profile preview`；
- `pnpm build:android:debug`；
- `pnpm build:ios:sim`。
