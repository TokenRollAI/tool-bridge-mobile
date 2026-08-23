# Local-only 通知参考

## 范围

本文记录 `phone/productivity.notify` 以及 `phone/inbox.deliver` 的可选固定提醒，如何使用
`expo-notifications 57.0.13` 创建即时本地通知。它们都不注册 push token、不接收 remote notification，
也不提供 mailbox/background reachability；信箱正文存储契约另见
`llmdoc/reference/local-device-inbox.md`。

## 输入、确认与内容

输入是 strict object：

- `purpose`：trim 后 1–120 个安全显示字符；
- `message`：trim 后 1–240 个安全显示字符。

两者拒绝 control 与 bidi override/isolate。caller 不能提供 title、data、action、URL、scheduleAt、sound、
badge 或其他未知字段。确认 UI 可以显示 purpose/message，但 native schedule request 只接收 commandId 与
message，不携带 caller 或 purpose。

native notification 内容固定：

- title：`Tool Bridge`；
- body：`Agent 通知：` + message；
- Android channel id：`tool_bridge_local_requests_v1`；
- identifier：`tb_local_notify_` + lowercase hex `SHA-256(commandId)`。

信箱提醒是另一套固定 payload：title `Tool Bridge 信箱`、body
`收到一条 Agent 来信，请在 App 内查看。`、identifier
`tb_local_inbox_ + lowercase SHA-256(commandId)`。schedule port 只接收该 identifier，不接收
title/body/sourceLabel/caller；它在信箱消息 commit 后才 best-effort 调用，失败不回滚内容。

Android channel 使用 default importance、private lockscreen visibility，并禁用 sound、vibration、light、
badge 和 DND bypass。前台 handler 只展示符合精确 deterministic identifier 形状的 notify、inbox 与 timer
本地通知；其他 local/remote identifier 仍默认抑制。

## 权限和 availability

远程 `notify` handler 只调用 `getPermissionsAsync` 与 channel probe，不调用 `requestPermissionsAsync`：

- granted 且 Android channel 未关闭：`available`；
- iOS not determined，或 Android 未授权但 `canAskAgain=true`：
  `unavailable: notification_permission_requestable`；
- 不可再请求的 denied：`unavailable: notification_permission_denied`，UI 引导系统设置；
- Android channel importance 为 NONE：`unavailable: notification_channel_disabled`，UI 引导系统设置；
- background、初始化失败、缺 channel 或 native probe 失败：结构化 unavailable。

只有用户主动点击本地 UI 才调用权限请求；请求前重建 channel，并有独立有界等待。Android API 36 fresh
install 可能把“尚未请求”表达为 `denied + canAskAgain=true`，必须映射为 requestable，不能与永久拒绝合并。

`phone/inbox.deliver` 同样只读取上述现有授权，远程投递不会请求权限。requestable 返回
`permission_required`；denied/channel disabled/adapter unavailable 返回 `unavailable`；读取或调度超时、
异常及不可信 native id 返回 `status_unknown`。取消或到期发生在内容 commit 后、提醒 commit 前时返回
`not_attempted`。

## commit 与结果语义

controller 在读取授权前和读取完成后都复检 `AbortSignal`/command `expiresAt`，只有授权有效才进入 native
schedule commit。commit 开始后不能再用后到的取消伪造“零副作用”；native 拒绝、悬挂或不安全 id 返回
`notification_status_unknown`。

成功结果只有：

- deterministic `notificationId`；
- `status: scheduled`；
- `presentation: system_determined`；
- 本地 `scheduledAt`。

`scheduled` 只证明系统 schedule API 返回受信 identifier，不证明通知已 presented、用户已看到或点击。
command outcome 和普通 audit 不保存 purpose/message；系统展示正文是该 capability 的显式副作用。

信箱的 `scheduled` 也只有上述系统接受语义，不证明 delivered/read；与 `phone/productivity.notify` 不同，
它的系统 payload 不包含远端正文，并且 notification 子结果不能改变消息已 `stored` 的事实。

## Final config 边界

Expo Notifications 默认包含远程通知相关原生资产，声明“local-only”必须复核最终产物，而不只看 JS API：

- `app.config.ts` 的 blocked permissions 移除 Android boot、exact alarm、C2DM 与厂商 badge 权限；
- `withLocalOnlyNotifications.cjs` 删除 iOS `aps-environment` entitlement；
- 同一 plugin 在 Android 移除 Expo/Firebase messaging services、Firebase receiver/provider，以及 Firebase
  data transport backend/job/alarm scheduler；
- plugin 以 `tools:node=replace` 保留不可导出的 `NotificationsService`，唯一 action 为本地
  `expo.modules.notifications.NOTIFICATION_EVENT`；最终 manifest 另保留不可导出的
  `NotificationForwarderActivity`。

Android 仍声明 `POST_NOTIFICATIONS`，因为本地通知需要系统授权。这套配置证明“没有 remote push 入口”，
不证明本地通知真机呈现，也不满足 U-5/U-6。

## 证据边界

- unit/local contract 覆盖 strict schema、固定 request/channel/id、权限映射、commit race、zero schedule、
  脱敏和 `scheduled` 语义；信箱另覆盖 commit 后提醒与失败不回滚。它们使用注入 adapter，不是系统 UI E2E。
- Android clean build 与 merged manifest 证明 local-only final config 可生成；API 36 emulator smoke 只证明
  fresh permission 映射和 capability 投影，未请求权限、调度、呈现或点击通知。
- 本机无完整 Xcode；iOS simulator/真机和 Android 真机均未验收。APNs entitlement 静态移除不等于 iOS
  local notification 行为已验证。

## 事实真源

- `src/capabilities/productivity/notificationSchema.ts`：strict purpose/message。
- `src/capabilities/productivity/notificationCapability.ts`：descriptor、confirmation、limits 与 invocation。
- `src/capabilities/productivity/notificationController.ts`：availability、commit、deadline 和 scheduled 结果。
- `src/capabilities/productivity/notificationAdapter.ts`：权限映射、固定内容/channel 与 deterministic id。
- `src/inbox/controller.ts`、`src/inbox/identifiers.ts`：信箱 commit 后提醒、子结果与 identifier。
- `plugins/withLocalOnlyNotifications.cjs`：APNs/FCM/Firebase 原生入口收敛。
- `app.config.ts`：blocked permissions、`POST_NOTIFICATIONS` 与 plugin 顺序。
