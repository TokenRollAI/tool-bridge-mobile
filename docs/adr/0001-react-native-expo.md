# ADR-0001：使用 React Native + Expo development build

- 状态：Accepted
- 日期：2026-08-19

## 背景

移动端需要共享 HTBP 协议、命令状态机和主要 UI，同时访问相机、音频、位置、push、后台任务和
系统安全存储。它不是纯内容 App，也不能把 Expo Go 当作生产运行时。

## 决策

使用 React Native + TypeScript 和 Expo Framework：

- 使用 development build；
- 使用 CNG / prebuild 生成原生工程；
- 使用 Expo SDK 提供的成熟设备模块；
- 缺失能力通过 Expo Modules API 以 Kotlin / Swift 实现；
- Android 先完成首个端到端切片，iOS 从第一天保持可构建和共有协议对等。

## 理由

- 与 Tool Bridge 的 TypeScript 生态、schema 和测试资产一致；
- 共享大部分协议、策略和 UI；
- 仍能使用真实原生项目、配置、库和自定义 native module；
- React Native 与 Expo 官方都把 Framework/development build 作为生产项目的推荐路径；
- 相比两套原生 App，减少非平台差异代码的重复。

## 后果

正面：

- 更快建立双端产品骨架；
- 协议和 capability handler 有统一类型边界；
- 原生差异可以局部下沉；
- 可使用 Expo 的模块、构建和更新生态但不强绑定 EAS。

代价：

- 团队仍需掌握 Kotlin、Swift、Xcode 和 Android Studio；
- 后台任务不能假设 JS runtime 常驻；
- push、媒体会话和敏感硬件需要真机与原生验证；
- Expo SDK 升级会成为定期工程工作；
- 某些能力最终可能主要由原生层实现。

## 被否决方案

- Flutter：增加 Dart 与类型生成链，不能复用 TypeScript SDK；
- 纯原生双端：P0 重复实现成本过高；
- PWA：系统能力和后台模型不足；
- Expo Go-only：无法覆盖自定义原生代码与生产 push。

## 复核条件

当有可重复的真机证据证明 React Native/Expo 使关键场景无法达成 DOD，或升级/性能成本持续高于
双原生维护成本时，重新评估。主观偏好不构成推翻 ADR 的依据。
