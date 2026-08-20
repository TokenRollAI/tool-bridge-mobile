# 技术选型

状态：P0 实现基线。精确版本与最低平台已由
[ADR-0002](adr/0002-app-scaffold-baseline.md) 锁定。

## 1. 结论

采用：

- React Native + TypeScript；
- Expo Framework，但使用 development build + prebuild/CNG，不以 Expo Go 为运行边界；
- Expo Router；
- Expo Modules API 编写 Kotlin / Swift 原生能力；
- SQLite 持久化命令、审计和偏好；
- SecureStore / 平台安全存储保存凭证；
- Zod 做所有远端输入的运行时校验；
- `@tool-bridge/sdk/device` 提供官方 React Native device transport 与 wire 状态机；
- APNs / FCM 原生 device token + Tool Bridge gateway 推送；
- Jest / React Native Testing Library 做组件和逻辑测试；
- Maestro 做关键真机/模拟器 E2E；
- GitHub Actions 做静态与协议验证，原生签名构建可接 EAS 或自托管 runner。

交付策略：**Android 首个端到端切片，iOS 从第一天保持可构建和协议对等。**

当前精确基线：Node `22.23.1`、pnpm `11.21.0`、Expo `57.0.14`、React Native `0.86.2`、
React `19.2.3`、TypeScript `6.0.3`、`@tool-bridge/sdk 0.11.0`。Android min/compile/target 为
`24/36/36`，iOS deployment
target 为 `16.4`。`package.json`、`.node-version`、`pnpm-lock.yaml` 和 App config 是版本事实真源。

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

以下是“能力到依赖”的初始映射，安装时用 `pnpm exec expo install` 选择与锁定 Expo SDK 兼容的
版本，再把精确版本与 lockfile 一并评审。

| 需求 | 选择 | 说明 |
| --- | --- | --- |
| 前台 device transport | `@tool-bridge/sdk/device` `0.11.0` | 官方 hello/ready/call/result、心跳、重连、cancel 与 RN WebSocket header adapter |
| 路由/深链 | `expo-router`、`expo-linking` | 配对、通知 action、确认页 |
| 本地通知与 timer 提示 | `expo-notifications` `57.0.12` | 当前：双端权限/channel probe、固定内容、即时/绝对 DATE local schedule |
| push | `expo-notifications` + gateway APNs/FCM | 目标：token、mailbox 提示与点击观察；U-5/U-6 未实现 |
| 凭证 | `expo-secure-store` | SK/refresh material；必要时下沉更强 key API |
| command / audit | `expo-sqlite` | 事务、幂等、crash recovery |
| 相机 | `expo-camera` | 可见预览和用户确认拍摄 |
| 音频 | `expo-audio` `57.0.3` | App 自有媒体播放、原生状态与系统媒体控制；显式关闭录音权限 |
| 媒体资源 | `expo-asset` `57.0.12` | `expo-audio` 要求的直接 peer；提供 player 原生资源解析 |
| 位置 | `expo-location` `57.0.11` | P1 一次性 foreground 位置；P2 单独评审后台能力 |
| 本地文件 | `expo-file-system` `57.0.4` | 受控媒体流式写入、实际字节上限和 App 私有 cache 清理 |
| 加密摘要 | `expo-crypto` | sha256、随机数据辅助 |
| 设备状态 | `expo-device`、`expo-battery`、`expo-network` | capability/status 的最小状态 |
| 后台回调 | `expo-task-manager` | push/background callback 编排 |
| schema | `zod` | 与 Tool Bridge 现有技术栈一致 |
| attention haptic | 本地 Expo Module `tool-bridge-attention` | Expo/RN 公共 API 无硬件 probe；仅封装 hasVibrator/CoreHaptics 与单次 pulse |

`@tool-bridge/sdk` 由 Tool Bridge 上游同仓维护，0.11.0 首次提供正式 `/device` export；已有依赖没有
官方 device frame/session 状态机，移动仓库也不得复制 `@tool-bridge/core` 私有源码。包根仍有 Node
依赖并声明 Node `>=22`，所以生产代码只导入 `/device`；仓库脚本锁定 export 和产物外部 import，
Android/iOS Metro 也必须实际 bundle。package 级 Node engine 由本仓库已锁定的 Node 22 构建环境满足，
不要求手机运行 Node。

`tool-bridge-attention` 是当前唯一自定义原生模块：成熟 Expo haptics API没有暴露双端硬件 probe，
而 capability 不能只按 OS 名称推断，因此使用最小 Kotlin/Swift 边界。Android 只声明普通
`VIBRATE` 权限；iOS haptic 不需要 usage description。声音、闪光与后台执行未进入该模块。

`expo-audio` 由 Expo 维护并与 SDK 57 同步发布，覆盖 Android/iOS；现有依赖没有音频 player、状态
事件或系统媒体控制。配置显式关闭 Android/iOS 录音，只启用可见后台播放。它本身不验证远端 MIME
或体积，因此 App 在创建 player 前用 `expo/fetch` 手动处理 redirect，并以 MIME header + 文件签名、
声明/实际 25 MiB 上限约束内容；player 在 `play()` 前另以 10 秒 metadata timeout 拒绝直播、无效时长
和超过 2 小时的媒体。不使用 URL 后缀猜测类型。对象 TTL 仍等待上游 `objectRef` 契约。
`expo-asset` 是 `expo-audio` 声明的 native peer，必须由 App 直接安装，不能依赖 pnpm 的传递安装；
版本按 Expo SDK 57 的 `bundledNativeModules.json` 精确锁定。

`expo-file-system` 同样由 Expo 维护并与 SDK 57 同步发布，覆盖 Android/iOS App 私有目录和流式文件
handle。媒体 resolver 的生产代码直接 import 它，因此即使它曾由其他 Expo 包传递安装，也必须作为
精确版本直接依赖；现有依赖没有可用于原生 player 的流式私有文件与确定性清理接口。

`expo-location` 同样由 Expo 维护并与 SDK 57 同步发布，覆盖双端 foreground 权限、权限精度和
可取消位置订阅；已有依赖无法提供这些原生 API。当前配置显式关闭 Android/iOS 后台位置、Android
location foreground service 与 motion activity，只生成 Android coarse/fine 和 iOS When In Use 权限。

`open_map` 复用已锁定的 `expo-linking 57.0.6`，不新增地图 SDK 或系统权限：业务层只接受结构化目标，
平台 builder 生成固定 map target，Linking 仅负责实际 probe/handoff。Android 11+ 的 package visibility
由本地 config plugin 只加入 `geo` + `ACTION_VIEW` query；不查询具体地图 package。现有 linking 已满足
这一系统交接需求，引入完整地图 SDK 会增加原生体积、位置数据面和维护成本。

`expo-notifications 57.0.12` 是 Expo 官方维护、与本仓库 SDK 57 本地
`bundledNativeModules.json` 一致的 Android/iOS 模块；已有依赖不提供通知授权、Android channel 或
双端 local schedule API。当前仅使用即时通知与 24 小时内单次 timer 的绝对 DATE trigger：Android 显式
声明 `POST_NOTIFICATIONS` 并阻止
`RECEIVE_BOOT_COMPLETED` / `SCHEDULE_EXACT_ALARM`，iOS 通过仓库 final config plugin 移除模块静态
plugin 默认加入的 APNs entitlement，且不启用 `remote-notification` background mode。业务代码不调用
push token API；即时 notify 不接受 schedule，timer 也只接受 canonical UTC firesAt 与确认 purpose，二者
都不接受调用方 title/data/action/sound/badge/channel，也不把安装模块等同于接通 push。
该 final plugin 还从 Android merged manifest 移除模块传递的 FCM/C2DM、Firebase 初始化/transport 和
厂商 badge 入口，只保留不可导出的 local notification event receiver 与点击转发 Activity。

官方模块索引：[Expo SDK reference](https://docs.expo.dev/versions/latest/)。

### Push 的目标选择（未实现）

`expo-notifications` 同时能获取 Expo token 和原生 device token。U-5/U-6 交付后的目标选择是：

- App 获取原生 APNs / FCM token；
- token 注册到 Tool Bridge gateway；
- gateway 直接对接 APNs / FCM；
- 不把 Expo Push Service 作为协议必需依赖。

理由：

- 网关需要掌握 delivery、token rotation 和设备撤销；
- push 与 command mailbox、设备身份属于同一安全域；
- 避免核心设备可达性依赖额外转发层；
- 仍可在原型期用 Expo Push Service，但不得让协议绑定它。

当前已安装模块和 `phone/productivity.notify/timer_*` 不满足上述任何 gateway push 交付项。Expo SDK 57 的权限、
channel、handler、schedule 与 token API 见
[Notifications API](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)。

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
- 前台实时：`@tool-bridge/sdk/device` + React Native WebSocket header adapter；当前支持首页手工 URL +
  API key 写入 SecureStore 的内测入口，短期 ticket 与正式 pairing 仍是 U-2/U-3；
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
| 协议契约 | 官方 SDK + fake WebSocket；后续真实 gateway fixture | 当前 frame/生命周期 consumer wiring；未来 mailbox、版本兼容 |
| E2E | Maestro | 配对、找手机、相机确认、撤销 |
| 真机矩阵 | 手工自动化结合 | push、后台、锁屏、DND、弱网 |

E2E 工具只负责驱动 UI；平台是否真正发声、振动、拍照和接收 push 仍需真机证据与运行日志。

## 9. 应用图标

品牌形状只在 `assets/icon/brand-mark.svg` 一处维护，形状按上游 `tool-bridge` 仓库根目录的
`tool-bridge.png` 逐行扫描测量重建，配色取 `src/ui/theme.ts` 的 `background` / `primary`，
和应用内视觉同源。四份 PNG 由 `pnpm icons:generate` 从该 SVG 导出并提交进仓库：

| 资源 | 用途 | 约束 |
| --- | --- | --- |
| `app-icon.png` 1024² | 通用与 iOS 应用图标 | 不透明；iOS 不接受 alpha |
| `adaptive-icon.png` 1024² | Android 自适应图标前景层 | 透明底；背景色走 `adaptiveIcon.backgroundColor` |
| `monochrome-icon.png` 1024² | Android 13+ 主题化图标 | 透明底；系统只读 alpha 并按壁纸取色 |
| `favicon.png` 48² | `react-native-web` 页签 | 不透明；小尺寸下笔画显著加粗 |

Android 自适应图标 108dp 画布中，系统保证不被任何厂商遮罩裁掉的只有居中 66dp 圆。标识宽扁
（1048:480），要让墨迹包围盒的半对角落进该圆，宽度上限约为画布边长的 0.548，因此前景层看起来
比 iOS 图标小一圈——这是换取任意遮罩下两端节点都不被切掉。

导出依赖 `rsvg-convert`（macOS `brew install librsvg`），它不进 `package.json`，也不在 CI 执行；
CI 跑的是 `pnpm verify:app-icons`，直接解析已提交 PNG 的尺寸、透明通道与上述安全区比例，并检查
`app.config.ts` 的引用完整，避免图标悄悄退回 Expo 默认或破掉平台约束。

## 10. CI/CD

### 每个 PR

- clean install；
- typecheck；
- lint；
- unit / component / local runtime contract；
- SDK device consumer contract；真实 gateway fixture 可用后加入 compatibility matrix；
- Android preview APK clean build；
- iOS simulator build（macOS runner）；
- 依赖、许可证与 secret 扫描；
- 文档链接检查。

### 合并 main

- 重跑 frozen install、verify、peer/dependency gate；
- 重跑 Android preview APK 与 iOS simulator clean build；
- 上传以 commit SHA 命名、保留 14 天的 preview APK 与 SHA-256；
- 安装到测试设备组、golden scenario smoke 和更长期 build metadata 仍未自动化。

### 版本 tag / GitHub Pre-release

- 只接受与 `package.json` / Expo `APP_VERSION` 一致的 `vX.Y.Z` tag；
- tag commit 必须带 `docs/releases/<tag>.md`，否则在任何原生 build 前 fail closed；
- tag workflow 重跑 frozen install、全量 verify、peer/dependency gate、Android preview APK 与 iOS
  simulator build；
- 双端门禁都成功后，自动创建 GitHub Pre-release，附版本化 Preview APK 与 SHA-256；
- GitHub token 只在最终 publish job 获得 `contents: write`，其他 job 保持只读；仓库不保存签名或服务密钥。

### Release

- 手工批准；
- Android App Bundle + iOS archive；
- 签名、entitlement、privacy manifest 和商店声明复核；
- staged rollout；
- 服务端 protocol compatibility gate；
- 可回滚到上一 App 版本和关闭 capability flag。

当前 `v0.0.2` 流程只实现前述 GitHub Pre-release，不是本节 production/store Release。它继续使用 Preview
application id 与 debug test key，不会生成 AAB/IPA、上传商店或绕过 gateway、真机、安全与合规门禁。

仓库已绑定到单一 Expo 项目 `@tokenroll/tool-bridge`（Project ID
`378c7a3e-437a-49a6-ae20-fef5af6f6188`）。development / preview / production 共用该项目身份，安装标识、
scheme、显示名称和 EAS environment 继续隔离；preview profile 显式生成 internal-distribution APK。
Project ID 是公开项目标识并进入 `app.config.ts`，不是凭证；任何 EAS token、签名私钥或服务密钥不得
进入仓库。

EAS Build 仍只是可替换的构建执行器，不是架构依赖；若成本、密钥治理或自托管要求不合适，可以切换
GitHub-hosted/self-hosted native runner。当前 GitHub Actions 继续承担 verify、双端 clean build gate 与
tag 驱动的 GitHub Preview 发布，
不能因 EAS 项目已关联就跳过仓库 CI。

当前 Android clean debug build 的工具链、命令和产物摘要记录在
[2026-08-19 Android debug 验证记录](verification/2026-08-19-android-debug.md)；安装和 UI smoke 记录在
[2026-08-19 Android emulator smoke](verification/2026-08-19-android-emulator.md)。macOS CI 已有 iOS
simulator 成功记录；它仍不能替代 iOS 真机、签名 archive 或商店包。

## 11. 未选择的方案

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

## 12. 重新评估触发条件

发生以下任一情况，新增 ADR：

- React Native/Expo 无法满足已验证的后台或平台 API；
- Expo module 引入不可接受的商店、权限或供应链风险；
- App 启动/内存性能达不到 DOD；
- 公共 device client 无法保持跨运行时边界；
- 需要把 CNG 生成目录纳入版本控制；
- push 供应链或签名设施发生变化。
