# 2026-08-19 Android emulator smoke

## 范围

本记录证明仓库的 development debug APK 可在 Android emulator 上从干净安装启动，并通过一条可重复
UI smoke 验证安装后权限、动态能力、本地安全状态、仅审计历史清除交互，以及四个标签页在 200%
系统字号下的语义名称、选中状态与关键操作尺寸。它不证明物理设备能力、iOS、release 构建、
后台/锁屏行为、读屏器实际朗读或 gateway 端到端链路。

## 环境

- macOS arm64 host；
- Android Emulator `37.1.11.0`，ADB `37.0.1-15733141`；
- Pixel 6 profile，`system-images;android-36;default;arm64-v8a`；
- Android `16` / API `36`，ABI `arm64-v8a`；
- development application id `ai.tokenroll.toolbridgemobile.dev`；
- APK SHA-256 `ae9f5a8253bff6427fe4b3c026ccf7439d74df35277c43b128c4b32b1b983d06`。

## 命令

先在一个终端运行 development server：

```sh
pnpm start
```

在已启动且完成 boot 的唯一 Android emulator 上执行：

```sh
mise exec android-sdk@22.0 node@22.23.1 -- pnpm verify:android:emulator
```

脚本默认连接 `http://localhost:8081`；可通过 `EXPO_DEV_SERVER_URL` 覆盖。它先卸载 dev application id，
安装 `android/app/build/outputs/apk/debug/app-debug.apk`，配置相同端口的 `adb reverse`，再用
development-client deep link 启动 App。preview/production application id 不在操作范围内。

## 通过证据

- 安装包报告 `versionCode=1`、`versionName=0.1.0`、`minSdk=24`、`targetSdk=36`；
- 最终包声明 foreground coarse/fine location、`POST_NOTIFICATIONS` 与 `VIBRATE`；
- 最终包不声明后台位置、录音、legacy external storage、development overlay、biometric、boot/exact、
  C2DM 或厂商 badge 权限，也不注册 FCM service/receiver/provider；
- 首页显示本地运行时 `ready`、transport `unconfigured`、控制模式 `ask_every_time`；
- capability 页显示真实 probe 结果，未授权 `phone/location.current` 显示
  `permission_required: foreground_location_permission_required`，没有假装 available；
- capability 页包含新注册的 `phone/location.open_map`；模拟器无地图 handler 时可显示
  unavailable，不伪造交接成功；
- fresh install 的 `phone/productivity.notify` 显示
  `unavailable: notification_permission_requestable`；这证明系统授权不会被远程绕过。Android 36 将
  未请求状态表达为 `denied + canAskAgain=true`，adapter 已与不可再请求的 denied 分开；
- capability 页包含 `phone/productivity.timer_start/timer_cancel/timer_status`；fresh 未授权时 start 复用
  requestable 降级，status/cancel 仍作为本地持久状态控制面注册；
- 点击紧急停用后模式变为 `disabled`，force-stop 并重新启动后仍为 `disabled`；恢复操作将模式切回
  `ask_every_time`；
- 活动页明确只显示最近 100 条、本机最多保留 5,000 条；fresh install 为空历史。smoke 先打开不可恢复
  范围确认并取消，再重新确认清除，页面真实报告删除 0 条；确认文案明确不删除 command 防重放、timer、
  设置、installation identity 或凭证；
- 四个 tab 分别暴露“状态/能力/媒体/活动标签页”的唯一可访问名称与正确 selected state；
- smoke 保存原系统字号、临时设为 200% 后 force-stop/relaunch，逐页验证仍可滚动并进入；活动页的
  清除、取消、确认操作均保留至少 48dp 的非零可点击区域；脚本 finally 恢复原字号，本次恢复为 1.0；
- smoke 期间 logcat 未出现该 App 的 `FATAL EXCEPTION`。

本轮 smoke 在 bounded media resolver、播放前时长闸门、结构化 `open_map`、local-only notify、SQLite
timer、活动历史清除、accessibility semantics 基线与 193 项全量测试加入后重新执行；它证明最新
Metro bundle 能启动、注册新能力，并走通空历史的范围确认/删除结果和 200% 字号语义交互，但没有
实际下载/播放音频、向地图 App 交接、请求/展示通知、调度 timer，
也没有在 emulator 生成远程 command audit，因此不作为媒体真机/解码、地图 handoff、通知呈现/点击、
timer 系统行为或有记录 SQLite clear 的替代证据；后者由 repository/contract test 覆盖。

脚本退出信息：

```text
Android emulator smoke 通过：安装/启动、local-only 通知与 timer 边界、动态能力、紧急停用持久化、活动历史清除确认及 200% 字号语义交互。
```

## 未覆盖

- emulator 不能证明 haptic、音频、DND/静音、耳机或其他物理输出；
- 未触发位置系统授权对话框，未验证 precise/approximate、定位精度、权限运行中撤销或系统服务关闭；
- 未验证后台、锁屏、杀进程唤醒、push、弱网、mailbox 或 gateway wire；
- 未触发通知系统授权对话框、通知呈现或点击；这些仍要求 Android/iOS 真机矩阵；
- 未实际创建/取消 timer，未验证系统 pending、到点呈现、进程 kill、reboot 或 Doze；这些仍要求真机；
- 活动页只清除了 fresh install 的 0 条记录；有记录 clear、并发 add 和清除后 replay 防重放由注入式
  SQLite/repository 与 local runtime contract 证明，未把 emulator 空态冒充这些场景；
- UIAutomator 只验证语义树、selected state、bounds 和点击；没有开启 TalkBack，也不能证明实际朗读、
  手势/焦点顺序、Switch Access、VoiceOver 或 iOS Dynamic Type；
- 只验证 `open_map` 能力注册和真实 probe 降级，未触发系统地图 App，双端真机交接仍待验收；
- 未运行 Android 原生 instrumentation，也没有 Android/iOS 真机证据；
- development server 和 development client 参与本次启动，不构成 release 安装 smoke。
