# Local-only 通知反思

## 任务

实现 `phone/productivity.notify` 的即时本地通知切片，同时确保引入 Expo Notifications 不会悄然扩大为
APNs/FCM push、后台唤醒或厂商 badge 能力。

## 错误假设

只在业务代码调用 `scheduleNotificationAsync`，不调用 push API，并不能证明产物是 local-only。
`expo-notifications` 及其 Android 依赖会贡献 remote messaging、Firebase provider/transport、boot/exact、
C2DM 和 badge 资产，iOS plugin 也可能生成 APNs entitlement；必须审计 final config 与 merged manifest。

权限状态也不能只按 `status === denied` 判断。Android fresh install 可返回 denied 且
`canAskAgain=true`，它仍是本地可请求状态；与 `canAskAgain=false` 合并会让 UI 错误地只提供 settings。

## 实现结果

- 远程 capability 从不请求权限；本地 UI 区分 requestable、permanent denied/settings 与 channel disabled。
- strict purpose/message 拒绝任意 title/data/action/schedule 字段；native title、body prefix、channel 和
  identifier 固定，identifier 由 commandId 的 SHA-256 确定性生成。
- controller 在授权 probe 前后复检取消/到期；commit 后只报告 `scheduled + system_determined`，不伪造
  presented/clicked，native 状态不明时返回不可重试的 unknown。
- final config 同时移除 APNs entitlement、Android remote notification/Firebase transport 入口和无关
  boot/exact/C2DM/badge 权限，只保留 local receiver/forwarder 所需资产。

## 证据层经验

- config introspection、plugin unit test、merged manifest、安装后 package 和 capability UI 是不同层；
  local-only 结论至少要覆盖最终原生配置，不能只看 TypeScript。
- 139 项全量测试、Android clean build 和 API 36 emulator smoke 已通过；smoke 只观察 fresh permission
  requestable 与 capability 注册，没有触发权限对话框、通知调度、呈现或点击。
- iOS 没有 Xcode build，双端真机尚未验收；本地通知也不解决 U-5 mailbox/U-6 push。

## 已提升的稳定知识

- `must/safety-boundaries.md` 增加远程不请求权限、固定通知内容、scheduled 证据语言和 final config 闸门。
- `architecture/capability-slices.md` 增加 productivity local-only slice。
- `reference/local-only-notifications.md` 固化权限映射、commit、native 内容和构建边界。

## 后续

- 每次升级 Expo Notifications 都要重跑 plugin/config、clean build、merged manifest 与安装包检查，不能假设
  上游组件名或默认权限不变。
- 双端真机需覆盖首次授权、永久拒绝/settings、channel off、前后台呈现及冷/热启动点击；结果仍不得从
  scheduled 升级为 delivered，除非新增真实观测协议。
- U-5/U-6 上游交付后应新增独立 push/mailbox adapter 和凭证/token 边界，不能复用 local-only capability
  名称声称后台可达。
