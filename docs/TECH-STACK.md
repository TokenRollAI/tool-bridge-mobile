# 技术选型

状态：P0 实现基线。精确版本在开始代码脚手架时锁定，不在规划文档中写浮动的“最新版”。

## 1. 结论

采用：

- React Native + TypeScript；
- Expo Framework，但使用 development build + prebuild/CNG，不以 Expo Go 为运行边界；
- Expo Router；
- Expo Modules API 编写 Kotlin / Swift 原生能力；
- SQLite 持久化命令、审计和偏好；
- SecureStore / 平台安全存储保存凭证；
- Zod 做所有远端输入的运行时校验；
- APNs / FCM 原生 device token + Tool Bridge gateway 推送；
- Jest / React Native Testing Library 做组件和逻辑测试；
- Maestro 做关键真机/模拟器 E2E；
- GitHub Actions 做静态与协议验证，原生签名构建可接 EAS 或自托管 runner。

交付策略：**Android 首个端到端切片，iOS 从第一天保持可构建和协议对等。**

## 2. 为什么选 React Native + Expo

React Native 官方建议新应用使用 framework，并把 Expo 作为 production-grade framework。
Expo 的 development build 支持任意原生库和 native configuration；需要自定义能力时可用 Expo
Modules API 写 Kotlin / Swift。

这正好匹配本项目：

- 大量协议、状态机、schema 和 UI 可以共享 TypeScript；
- 相机、位置、通知、音频和安全存储已有稳定 Expo 模块；
- 受平台限制的后台行为可以下沉原生模块；
- 团队可复用 HTBP / Tool Bridge 的 TypeScript 类型和测试资产；
- 保留真正的 Android/iOS 原生工程和商店能力，不受 Expo Go 限制。

官方依据：

- [React Native：新应用推荐使用 Framework](https://reactnative.dev/docs/environment-setup)
- [Expo development build 与 prebuild 工作流](https://docs.expo.dev/workflow/overview/)
- [Expo Modules API：用 Swift/Kotlin 添加原生能力](https://docs.expo.dev/modules/overview/)

## 3. Expo 工作流

### 选择

- 使用 Continuous Native Generation（CNG）；
- `android/`、`ios/` 初期由 `expo prebuild --clean` 生成并忽略；
- 原生变更优先写 config plugin 或本地 Expo Module；
- CI 使用 development/preview/release 三种 profile；
- push、后台任务、相机等功能以 development build/真机构建验收。

### 不使用 Expo Go 验收

Expo 官方把 Expo Go 定位为有限的 playground；远程 push 等能力也要求 development build。
这个项目从 P0 就涉及 native configuration 和后台生命周期，因此 Expo Go 只能用于无原生依赖的
临时 UI 实验，不能作为功能完成证据。

## 4. 语言与代码组织

### TypeScript

- 开启 `strict`；
- 远端数据永远从 `unknown` 开始；
- 协议、policy、command state machine 和 capability interface 写成纯 TS；
- React 组件不直接发协议帧或调用原生模块。

建议结构：

```text
app/                       Expo Router 页面
src/
  capabilities/            能力注册与跨平台 handler
  commands/                command lifecycle / idempotency
  gateway/                 pairing、HTTP、realtime、mailbox adapters
  identity/                device id 与 credential facade
  policy/                  本地裁决与确认
  storage/                 SQLite repositories
  audit/                   脱敏审计
  ui/                      共享组件
modules/
  tool-bridge-device/      必要的 Expo native module
scripts/
e2e/
```

### Kotlin / Swift

只有以下情况才写原生代码：

- Expo SDK 没有需要的系统 API；
- 后台/生命周期必须由原生层接管；
- 平台媒体会话、通知 action 或安全密钥能力需要原生集成；
- 已有 React Native 包无法满足维护、安全或新架构要求。

原生模块通过 Expo Modules API 暴露最小、类型化接口，不暴露任意 Intent、selector 或原生对象。

## 5. 核心依赖

以下是“能力到依赖”的初始映射，安装时用 `npx expo install` 选择与锁定 Expo SDK 兼容的版本。

| 需求 | 选择 | 说明 |
| --- | --- | --- |
| 路由/深链 | `expo-router`、`expo-linking` | 配对、通知 action、确认页 |
| push / 本地通知 | `expo-notifications` | 获取原生 APNs/FCM token、通知交互 |
| 凭证 | `expo-secure-store` | SK/refresh material；必要时下沉更强 key API |
| command / audit | `expo-sqlite` | 事务、幂等、crash recovery |
| 相机 | `expo-camera` | 可见预览和用户确认拍摄 |
| 音频 | `expo-audio` | App 自有媒体播放 |
| 位置 | `expo-location` | P1 一次性位置；P2 单独评审后台能力 |
| 本地文件 | `expo-file-system` | 待上传媒体和清理 |
| 加密摘要 | `expo-crypto` | sha256、随机数据辅助 |
| 设备状态 | `expo-device`、`expo-battery`、`expo-network` | capability/status 的最小状态 |
| 后台回调 | `expo-task-manager` | push/background callback 编排 |
| schema | `zod` | 与 Tool Bridge 现有技术栈一致 |

官方模块索引：[Expo SDK reference](https://docs.expo.dev/versions/latest/)。

### Push 的选择

`expo-notifications` 同时能获取 Expo token 和原生 device token。这里选择：

- App 获取原生 APNs / FCM token；
- token 注册到 Tool Bridge gateway；
- gateway 直接对接 APNs / FCM；
- 不把 Expo Push Service 作为协议必需依赖。

理由：

- 网关需要掌握 delivery、token rotation 和设备撤销；
- push 与 command mailbox、设备身份属于同一安全域；
- 避免核心设备可达性依赖额外转发层；
- 仍可在原型期用 Expo Push Service，但不得让协议绑定它。

Expo 官方说明 `expo-notifications` 可获取原生 token：
[Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)。

## 6. 状态管理

P0 不引入大型全局状态框架。

- 持久状态以 SQLite repository 为真源；
- realtime connection、capability registry 和 policy engine 是独立 service；
- React 层通过细粒度 store adapter / `useSyncExternalStore` 订阅；
- server state 不使用“自动重试一切”的通用 query 默认值，避免重放副作用；
- 当 UI 状态复杂度达到明确阈值后再评估 Zustand 等轻量库。

这避免同时维护 Redux store、SQLite、device client 三份互相漂移的 command 状态。

## 7. 网络与协议

- HTTP：React Native 标准 `fetch`，由 gateway client 包装超时、错误和 redaction；
- 实时：标准 WebSocket adapter + 上游短期 ticket；
- 后台：mailbox HTTP pull/claim/result；
- 上传：网关签发单次预签名 URL，文件直传对象存储；
- 实时媒体：P2 WebRTC；
- 所有 endpoint/schema 由上游 SDK 导出，移动仓库不手写第二份 wire 类型。

不引入通用重试库来自动重试有副作用请求。重试由 command/idempotency 语义显式控制。

## 8. 测试

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 纯逻辑 | Jest | policy、状态机、schema、redaction |
| React UI | React Native Testing Library | 权限/确认/错误界面 |
| 原生模块 | XCTest / Android instrumentation | 平台 adapter |
| 协议契约 | fake transport + 上游 fixtures | frame、mailbox、版本兼容 |
| E2E | Maestro | 配对、找手机、相机确认、撤销 |
| 真机矩阵 | 手工自动化结合 | push、后台、锁屏、DND、弱网 |

E2E 工具只负责驱动 UI；平台是否真正发声、振动、拍照和接收 push 仍需真机证据与运行日志。

## 9. CI/CD

### 每个 PR

- clean install；
- typecheck；
- lint；
- unit / component / protocol contract；
- Android debug build；
- iOS simulator build（macOS runner）；
- 依赖/secret 扫描；
- 文档链接检查。

### 合并 main

- preview build；
- 安装到测试设备组；
- golden scenario smoke；
- 产出可追溯 build metadata。

### Release

- 手工批准；
- Android App Bundle + iOS archive；
- 签名、entitlement、privacy manifest 和商店声明复核；
- staged rollout；
- 服务端 protocol compatibility gate；
- 可回滚到上一 App 版本和关闭 capability flag。

EAS Build 是可选的构建执行器，不是架构依赖；若成本、密钥治理或自托管要求不合适，可以切换
GitHub-hosted/self-hosted native runner。

## 10. 未选择的方案

### Flutter

优点是跨平台 UI 一致、性能稳定；未选原因是本生态协议和 SDK 资产以 TypeScript 为主，仍需维护
大量 Kotlin/Swift 平台能力，采用 Dart 会增加第三种主要语言和协议类型生成链。

### 纯 Swift + Kotlin 两套 App

平台控制力最强，但 P0 的协议、策略、命令状态和 UI 会重复实现。若后续证明后台执行或系统集成
长期受到 React Native runtime 限制，可把能力逐步下沉原生，而无需立即放弃共享层。

### PWA

无法提供所需的后台、相机、媒体会话、系统通知和安全凭证能力，不适合设备运行时。

### 只用 Expo managed / Expo Go

无法作为本项目的长期边界，因为自定义 native module、push 和后台行为需要 development build
以及真实原生配置。

### 在移动仓库重写 HTBP client

短期看快，长期会产生协议分叉、修复不同步和安全边界不一致。必须以公共跨运行时 SDK 作为 P0
上游闸门。

## 11. 重新评估触发条件

发生以下任一情况，新增 ADR：

- React Native/Expo 无法满足已验证的后台或平台 API；
- Expo module 引入不可接受的商店、权限或供应链风险；
- App 启动/内存性能达不到 DOD；
- 公共 device client 无法保持跨运行时边界；
- 需要把 CNG 生成目录纳入版本控制；
- push 供应链或签名设施发生变化。
