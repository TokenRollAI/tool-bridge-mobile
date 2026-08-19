# 2026-08-19 Android debug 验证记录

## 范围

本记录只证明当前工作树可以从 Expo clean prebuild 构建 Android development debug APK。它不证明
iOS 可构建、CI 已通过、真机功能有效、release 可签名或产物可追溯到一个已提交 commit。

## 环境

- macOS arm64；
- Node.js `22.23.1`；
- pnpm `11.21.0`；
- Eclipse Temurin Java `17.0.20+8`；
- Android SDK platform `36`、build-tools `36.0.0`；
- Gradle wrapper `9.3.1`；
- Expo `57.0.14`、React Native `0.86.2`、expo-audio `57.0.3`、expo-file-system `57.0.4`、
  expo-location `57.0.11`、expo-notifications `57.0.12`。

Java 与 Android SDK 通过本机隔离的 mise 工具链提供，没有把 SDK、NDK、证书或调试 APK 提交到仓库。

## 命令与结果

```sh
mise exec android-sdk@22.0 java@temurin-17.0.20+8 node@22.23.1 -- \
  pnpm build:android:debug
```

结果：`BUILD SUCCESSFUL in 1m 11s`，696 个 Gradle task 中 664 个执行、32 个 up-to-date。仓库脚本
先运行 `expo prebuild --clean --platform android`，再运行 `./gradlew assembleDebug`，因此不是只验证
已有的 generated native tree。

本次本地产物：

- 路径：`android/app/build/outputs/apk/debug/app-debug.apk`；
- 大小：`263308621` bytes；
- SHA-256：`ae9f5a8253bff6427fe4b3c026ccf7439d74df35277c43b128c4b32b1b983d06`。

该轮构建包含 P1-B `expo-audio` / `expo-file-system` 与 P1-D `expo-location` 原生模块；Gradle 的 Expo
module 列表明确包含 `expo-file-system (57.0.4)`。merged debug manifest 含非导出的
`expo.modules.audio.service.AudioControlsService` 与 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`，不含
`RECORD_AUDIO`；位置只含 `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`，不含
`ACCESS_BACKGROUND_LOCATION` 或 `FOREGROUND_SERVICE_LOCATION`。
新增的地图交接配置在 merged manifest 中仅添加 `android.intent.action.VIEW` + `geo`
package-visibility query，不添加地图 SDK、位置权限或对特定地图 App 的绑定。
本地通知配置在 merged manifest 中声明 `POST_NOTIFICATIONS`，只保留不可导出的
`NotificationsService`（唯一 action 为 `expo.modules.notifications.NOTIFICATION_EVENT`）与不可导出的
`NotificationForwarderActivity`。`RECEIVE_BOOT_COMPLETED`、`SCHEDULE_EXACT_ALARM`、C2DM 和厂商 badge
权限，以及 Expo/Firebase messaging service、receiver、provider 与 Firebase transport scheduler 均被
final config plugin 移除；这不等于真机已展示通知，也不满足 U-6 push。
同一 native 模块现也承载 24 小时内 App timer 的绝对 DATE trigger；SQLite v2 与 timer 状态机属于
TypeScript/SQLite 运行时。本轮 clean build 证明最终原生配置仍可生成且没有因 timer 引入 boot/exact/
remote push 入口，不证明 timer 准点、呈现、取消竞态或 reboot 行为。
本地 attention 模块在 API 26+ 使用 `VibrationEffect.createOneShot`，API 24–25 显式走兼容的
deprecated `Vibrator.vibrate(long)` 分支；本次 clean build 已编译该最低版本兼容分支。

Expo 依赖默认 manifest 还可能引入 legacy external storage、生物识别或 development overlay 权限；
本次 clean prebuild 的 merged debug manifest 不含 `READ_EXTERNAL_STORAGE`、`WRITE_EXTERNAL_STORAGE`、
`USE_BIOMETRIC`、`USE_FINGERPRINT` 或 `SYSTEM_ALERT_WINDOW`。最终安装包的独立复核见
[Android emulator smoke](2026-08-19-android-emulator.md)。

该 APK 来自基线 commit `f44d4f8` 加当前未提交实现，故不能满足 release DOD 的“artifact 可追溯到
commit”。提交后应由 clean-checkout CI 重新构建并记录新的 artifact digest。

## 未覆盖

- 完整 Xcode 不在本机，未执行 iOS simulator build；
- APK 已另行安装到 emulator 并完成 UI smoke，但未安装到 Android 真机；
- 未验证 haptic 的物理输出、DND/静音、后台或锁屏行为；
- 未验证系统位置权限对话框、precise/approximate 切换、位置精度或服务撤销行为；
- 未在 Android 真机验证 `geo:` 交接，也未在 iOS 真机验证 Apple Maps link；
- 未在双端真机验证通知授权、channel off、前台/后台呈现或冷/热启动点击；
- 未在双端真机验证 timer 的前台/后台/锁屏、进程 kill、Android reboot、Doze/低电量、运行中权限撤销
  或到点取消竞态；
- 未执行 release 签名、安装 smoke、性能或 24 小时稳定性测试。
