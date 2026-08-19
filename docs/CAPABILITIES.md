# 移动端能力目录

状态：产品提案 + P0 本地运行时，以及已明确标记的 attention、media、apps、location 与 productivity
本地切片；除明确标记的本地实现或“当前协议可表达”外，均不代表已经实现。

## 1. 命名与返回约定

设备默认挂载在：

```text
device/<deviceId>/phone/*
```

调用路径沿用 Tool Bridge 的“节点路径 + tool 名称”模型，例如：

```http
POST /device/my-phone/phone/attention
{
  "tool": "ring",
  "arguments": {
    "durationSeconds": 30,
    "vibrate": true,
    "flash": true
  }
}
```

能力元数据沿用当前 `DeviceExpose.nodes[].cmds[]` 可表达的字段：

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `effect`
- `confirm`

建议的后续 profile 元数据（需先进入 HTBP / Tool Bridge 正式契约）：

- `availability`：available / unavailable / foreground_only / permission_required；
- `confirmation`：never / when_locked / always；
- `queuePolicy`：reject_offline / enqueue；
- `platforms`：Android / iOS 及最低版本；
- `resultMode`：inline / object_ref / stream；
- `risk`：low / medium / high；
- `limits`：速率、时长、结果大小。

### 当前本地 execution limits

以下 `limits` 只存在于移动端本地 registry，不是尚未发布的 gateway capability profile。executor 在
native probe 和本地确认前按 caller/global 滑动窗口做 admission，并在持久化成功结果前按 UTF-8 JSON
字节数执行 inline 上限；同一 `commandId` 的 replay 不重复计数。当前 admission 为进程内防护，App
重启后窗口重置，不能替代上游账户/设备配额。

| capability | caller / global（每 60 秒） | inline 结果上限 |
| --- | ---: | ---: |
| `phone/status.get` | 60 / 120 | 16 KiB |
| `phone/attention.ring` | 3 / 6 | 8 KiB |
| `phone/attention.stop` | 60 / 120 | 4 KiB |
| `phone/media.play` | 10 / 20 | 8 KiB |
| `phone/media.pause/resume/seek/stop/status` | 60 / 120 | 8 KiB |
| `phone/apps.can_open_url` | 30 / 60 | 4 KiB |
| `phone/apps.open_url` | 10 / 20 | 4 KiB |
| `phone/location.current` | 6 / 12 | 4 KiB |
| `phone/location.open_map` | 10 / 20 | 4 KiB |
| `phone/productivity.notify` | 5 / 10 | 2 KiB |
| `phone/productivity.timer_start` | 5 / 10 | 2 KiB |
| `phone/productivity.timer_cancel/timer_status` | 60 / 120 | 2 KiB |
| `phone/runtime.capabilities/pending_commands` | 60 / 120 | 32 KiB |
| `phone/runtime.cancel` | 60 / 120 | 2 KiB |

结果超限返回 `result_too_large`，大值不进入 SQLite。rate limit、command deadline、能力自身 timeout
和用户可停止 session 是不同边界。HTTPS 媒体另有 MIME/签名、redirect 最终 URL 和 25 MiB 实际
传输上限；加载到 player 后还会在 `play()` 前拒绝直播、无效时长和超过 2 小时的媒体。`objectRef`
仍未实现。

## 2. P0：运行时与状态

### `phone/status`

#### `get`

用途：让 Agent 在执行前了解设备可达性和约束。

当前本地实现使用 strict 空对象 schema `{}`，从 Battery、Network 和 AppState probe 返回状态。
`battery` / `network` 各自使用 `{ availability: 'available', value }` 或
`{ availability: 'unavailable', reason }`；同时返回本地 `installationId` 和
`reachability: 'disabled' | 'unconfigured' | 'offline' | 'online'`。前台 SDK transport 只有收到 gateway
`ready` 才返回 online；没有 origin/credential、连接中/暂停或 Disabled 都不会伪装在线。`installationId`
仍不是下例中的 gateway `deviceId`。

| 平台 | 当前本地支持 |
| --- | --- |
| Android 7.0+ | 前台 AppState、电量与网络 probe；字段失败逐项 unavailable |
| iOS 16.4+ | 前台 AppState、电量与网络 probe；字段失败逐项 unavailable |

建议返回：

```json
{
  "deviceId": "phone_a1b2",
  "platform": "android",
  "appState": "foreground",
  "reachability": "online",
  "controlMode": "ask_every_time",
  "battery": {
    "level": 0.72,
    "charging": false
  },
  "network": {
    "type": "wifi",
    "metered": false
  },
  "permissions": {
    "notifications": "granted",
    "camera": "granted",
    "location": "while_in_use"
  },
  "observedAt": "2026-08-19T03:00:00Z"
}
```

约束：

- `effect: read`；
- 不返回设备序列号、IMEI、广告 ID、Wi-Fi SSID 或不必要的硬件标识；
- 不可读取的字段省略或带结构化 availability，不能填假值。

### `phone/runtime`

| 工具 | 用途 | 风险 | 阶段 |
| --- | --- | --- | --- |
| `capabilities` | 返回当前本地 registry descriptor 与实时 availability | low | 本地已实现 |
| `pending_commands` | 返回仍在等待确认/执行的安全命令元数据 | low | 本地已实现 |
| `cancel` | 请求取消尚未完成且可中断的本地命令 | low | 本地已实现 |

这三个工具只使用 `@tool-bridge/sdk/device@0.11.0` 已有的自定义 command、result 与 cancel signal 能力，
没有增加 wire 字段。当前 SDK call 不携带具体 Agent identity，因此查询和取消严格按 device credential
的非秘密 `keyId`（结果中标为 `gateway_credential_principal`）隔离，不能描述为具体 Agent ownership。
`pending_commands` 不返回 arguments、confirmation detail 或结果正文；`cancel` 只报告
`cancellation_requested`，不虚报目标已经完成取消。它们不等于尚未交付的 mailbox/claim 状态机。

## 3. P1：注意力与找手机

### `phone/attention`

当前本地实现范围：

- `ring` / `stop` 已有 strict schema、session TTL、本地 stop UI、commandId 幂等 contract，以及每
  调用方 3 次/分钟、设备全局 6 次/分钟的滑动窗口限流；运行时 session 投影只含调用方 subject、
  剩余秒数和 sessionId，不含完整 message；
- 只在 App 前台且内置本地提示音或 native haptic 至少一个 probe 可用时声明 `ring` available；Android
  haptic 使用 `Vibrator.hasVibrator()`，iOS 使用 `CHHapticEngine.capabilitiesForHardware()`；
- `sound: find_device` 使用 App 在私有 cache 中本地生成的固定 PCM WAV，通过 `expo-audio` 循环请求播放；
  不下载远程声音、不请求相机权限、`playsInSilentMode: false`，也不绕过 DND；
- 结果按通道使用 `requested` / `unavailable`，不把 native API 接受请求等同于用户一定感知；flash 仍
  明确为 `flash_not_implemented`，没有 Camera 权限或伪实现；
- 前台 SDK transport 已接入，但尚无 pairing、真实 gateway compatibility、后台 mailbox/push、声音、
  闪光或双端真机物理效果证据，因此不构成完整“找手机”能力。

| 平台 | 当前本地支持 |
| --- | --- |
| Android 7.0+ | 前台；固定本地 WAV + `expo-audio`，可选 haptic；普通 `VIBRATE` 权限 |
| iOS 16.4+ | 前台；固定本地 WAV + `expo-audio`，可选 CoreHaptics；无额外权限 |
| Web/模拟器无硬件 | `unavailable`，不得以模拟成功替代真机证据 |

#### `ring`

建议入参：

| 字段 | 类型 | 默认 | 限制 |
| --- | --- | --- | --- |
| `durationSeconds` | integer | 30 | 1–120 |
| `sound` | string enum | `find_device` | 仅内置音效 |
| `vibrate` | boolean | true | 受系统能力限制 |
| `flash` | boolean | false | 使用闪光灯时需能力探测 |
| `message` | string | 无 | 最长 120 字，过滤控制字符 |

结果必须报告每个通道的实际状态：

```json
{
  "sessionId": "attention_01",
  "expiresAt": "2026-08-19T03:01:00Z",
  "channels": {
    "sound": "playing",
    "vibration": "active",
    "flash": "unavailable"
  }
}
```

本地实现暂时返回 `requested` 而非上例的 `active/playing`；只有真机观测链建立后才能升级状态语义。

#### `stop`

停止指定 `sessionId` 或本设备全部找机提示。设备本地停止按钮优先级最高。

`ring` 安全边界：

- 按调用方和设备限流；
- 不允许下载远程声音作为提示音；
- 不承诺突破系统 DND / 静音策略；
- 命令过期立即停止；
- session deadline 取 `durationSeconds` 与 command `expiresAt` 的较早值；
- `ring` 为 `effect: write`，默认允许 trusted session，但用户可改为每次确认。

## 4. P1：媒体

### `phone/media`

当前本地实现范围：

- 注册 `play/pause/resume/seek/stop/status` strict schema；`play.title`、各控制工具的 `sessionId`
  以及 `seek.positionMs` 必填，seek 只接受 0 至 7,200,000 毫秒且不得超过已探测媒体时长；
- `play.source` 当前只接受 `{ kind: 'https', url }`，且 hostname 必须在非秘密构建变量
  `EXPO_PUBLIC_MEDIA_HOSTS` 的精确 allowlist 中；拒绝 HTTP、内嵌凭证、非 443 端口、fragment、
  IP literal 和未授权 hostname；
- 创建 player 前使用 `credentials: omit`、`redirect: manual` 受控获取，每个 redirect 目标与最终
  response URL 都重新执行来源策略；只接受音频 MIME allowlist 且文件头签名必须匹配；
- `Content-Length` 与流式实际字节分别执行 25 MiB 硬上限，30 秒本地 timeout 和 command
  `AbortSignal` 都会终止读取；来源写入 App 私有 cache，失败、取消、停止和下次初始化时清理，
  `expo-audio` 只接收内部 `file://` URI；
- player metadata 最多等待 10 秒；直播、无法得到有效时长或超过 2 小时的媒体会在调用 `play()` 前
  拒绝并清理本地缓存；
- 同一时刻只有一个 App 自有 player；活动会话期间的第二个 `play` 返回 `media_active`，相同
  `commandId` 由持久化 executor 回放首次结果；
- session projection 只含 `sourceHost`、标题、调用方、MIME、大小、进度和状态，不保存完整 URL/query；
- Android 配置可见 media playback foreground service，iOS 配置 `audio` background mode；player
  使用系统 lock-screen metadata/control 并把 native 状态事件映射为 loading/playing/paused/
  interrupted/stopped/failed；
- 尚无双端真机锁屏、后台、耳机拔出/来电中断证据，也尚未实现 `objectRef`；第三方 App handoff
  已由独立的 `phone/apps` 能力实现，但不能把本地 contract 视为完整 P1-B 验收。

| 工具 | 主要入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `play` | `source`、`title`、`artist?` | playback session | 当前只播放受控下载后的 allowlisted HTTPS 音频 |
| `pause` | `sessionId` | 当前状态 | 暂停本 App 会话 |
| `resume` | `sessionId` | 当前状态 | 恢复本 App 会话 |
| `stop` | `sessionId` | stopped | 停止并释放资源 |
| `seek` | `sessionId`、`positionMs` | 当前状态 | App 自有 player 定位到受限毫秒位置 |
| `status` | `sessionId` | 当前媒体和控制能力 | read |

当 `EXPO_PUBLIC_MEDIA_HOSTS` 为空时，本机能力页仍显示 `media_hosts_unconfigured`，但这些媒体工具不会
作为 command 进入 SDK expose；App 会发送同 path 的空 command 集合以清理旧 session 的注册残留。
`EXPO_PUBLIC_LINK_HOSTS` 为空时 App handoff 同理。这样 Agent 不会发现一个在当前构建中注定
unavailable 的静态工具。

目标 `source` 是以下联合类型；当前 strict schema 仅接受第一种，第二种等待上游正式契约：

```ts
type MediaSource =
  | { kind: 'https'; url: string }
  | { kind: 'object'; objectRef: string }
```

不接受 `file://`、任意 content URI、凭证内嵌 URL 或 shell 命令。

“播放 Spotify / Apple Music 某首歌”在 MVP 中拆成两个不同语义：

1. App 自有播放器拿到合法媒体 URL 后播放，结果可持续观测；
2. `phone/apps.open_url` 把搜索/专辑深链交给第三方 App，结果仅为 handed_off。

## 5. P1：本地辅助

### `phone/productivity`

| 工具 | 能力 | 默认确认 | 平台备注 |
| --- | --- | --- | --- |
| `notify` | 创建本地可见通知 | trusted session 可免 | Android/iOS |
| `timer_start` | 创建 App 内计时器 | trusted session 可免 | Android/iOS |
| `timer_cancel` | 取消 App 内计时器 | trusted session 可免 | Android/iOS |
| `timer_status` | 读取 App 内计时器的可观察状态 | 无 | Android/iOS |

#### `notify`

当前已实现的唯一通知能力路径是 `phone/productivity.notify`；不存在行为不同的
`phone/attention.notify`。它是 App 前台触发的即时本地通知，不是 gateway push 或 mailbox 唤醒。

strict 入参：

```json
{
  "purpose": "提醒提交报销",
  "message": "今天 18:00 前提交本周报销"
}
```

- `purpose` trim 后 1–120 字符，`message` trim 后 1–240 字符；两者拒绝 C0/C1 控制字符和 bidi
  override/isolate；unknown field 一律拒绝；
- caller 不能提供 `title`、`url`、`data`、`action`、`sound`、`badge`、`scheduleAt` 或 channel；
- `effect: write`、`risk: medium`、`confirmation: when_locked`、`queuePolicy: reject_offline`；默认
  Ask every time 仍逐次确认；admission 为每 caller 5 次、设备全局 10 次/60 秒，inline 结果 2 KiB；
- capability probe 要求 App active、通知授权有效，且 Android 固定 channel 未被关闭。系统仍允许
  请求时返回 `notification_permission_requestable`；不可再请求或 channel disabled 返回独立
  unavailable reason；远程命令绝不调用权限请求 API；
- 权限请求只来自首页用户主动操作：先展示本地说明，再请求 alert 权限；不可再请求的拒绝或 channel
  被关闭时，首页只提供打开系统设置入口；
- OS 标题固定为 `Tool Bridge`，正文固定带 `Agent 通知：` 前缀；caller、purpose、URL、动作或其他
  data 不写入 OS 通知；固定 channel 关闭声音、振动、灯、badge 与 DND bypass；
- native identifier 为 `tb_local_notify_` 加 `commandId` 的 SHA-256；前台 handler 只允许这一精确
  形式，其余本地/远程 notification identifier 默认不展示；
- 成功 result 只包含 `{ notificationId, status: 'scheduled', scheduledAt,
  presentation: 'system_determined' }`。`scheduled` 只表示原生调度 promise 已返回，不表示系统已展示、
  用户已看见或点击；当前未实现 delivered/clicked observation；
- 持久化 command outcome 和普通 audit 不保存 message/purpose。重复或跨 executor replay 只返回首次
  结果；crash 留下的 running command 变为 `result_unknown`，不会重放通知副作用。

| 平台 | 当前本地支持 | 未完成证据 |
| --- | --- | --- |
| Android 7.0+ | `POST_NOTIFICATIONS`、固定 runtime channel、即时 local schedule；无 boot/exact、C2DM/vendor badge 权限或 FCM 注册组件 | Android 13+ 真机授权、channel off、前后台呈现与点击 |
| iOS 16.4+ | alert-only 用户授权、即时 local schedule；无 APNs entitlement、无 remote-notification mode | 真机授权、前台/锁屏呈现与冷/热启动点击 |

安装 `expo-notifications` 仅提供双端本地原生 API；当前代码不调用 push token API，不接收 U-6 push，
也不能用模拟器或 schedule promise 替代上述真机验收。

#### `timer_start` / `timer_cancel` / `timer_status`

当前实现是“SQLite 真源 + 系统绝对 DATE trigger 的 best-effort 提示”，不是 JS `setTimeout`、闹钟或
delivery tracker。`timer_start` strict 入参：

```json
{
  "firesAt": "2026-08-19T10:30:00.000Z",
  "purpose": "10 分钟后检查烤箱"
}
```

- `firesAt` 必须是毫秒精度、`Z` 结尾的 canonical UTC；handler 真正执行时目标须在当前时间 10 秒至
  24 小时内。`purpose` trim 后 1–120 字符并拒绝 control/bidi，只在本地确认 UI 显示；
- unknown field 一律拒绝，包括 caller 提供的 duration/timezone、label/message/title、repeat、URL、
  data、action、sound、badge 与 channel；原生内容固定为 `Tool Bridge / Agent 计时器已到期`；
- start 为 write/medium/when_locked/reject_offline，5/10 次每分钟、2 KiB result；另由 SQLite reserve
  事务原子限制活动 timer 为每 caller 8、全设备 32；
- start 只在 App active 且通知授权/channel 可用时 available，远程命令仍不会请求权限。status/cancel
  在权限撤销后仍可读取/清理；Ask every time 模式下 write cancel 仍由总 policy 要求确认，设备本地取消
  入口直接执行保护性清理；
- `timerId = timer_ + SHA-256(source commandId)`，native identifier 使用同一 digest 的
  `tb_local_timer_` 前缀；前台 handler 只允许精确的 notify/timer 两类本地标识，其他 local/remote
  identifier 默认抑制；
- SQLite v2 保存 owner、目标时间、确定性标识和 `preparing/scheduled/cancelling/cancelled/
  deadline_elapsed/status_unknown`，不保存 purpose 或任意正文。source command 的活动 timer 不被 command
  retention 提前删除；终态 timer 自身有 500 条 retention；
- `timer_cancel` / `timer_status` strict 入参均只有 `{ "timerId": "timer_<64 lowercase hex>" }`，只能
  访问同一 caller 创建的 timer；异主与不存在统一 `not_found`；
- start result 是 `{ timerId, firesAt, state: 'scheduled', scheduling: 'system_accepted',
  accuracy: 'system_determined' }`。status 会返回 pending observed、schedule missing、deadline elapsed、
  cancelled 或 status unknown；cancel 只在有界 cancel+dismiss 都返回后报告 cancelled，并始终保留
  `presentation: 'unknown'`；
- crash/restart 对账发生在 command recovery 后、command prune 前：未知 source command 的 orphan 只清理，
  不重调度；成功且未到期但系统 pending 缺失的 timer 仅在未 Disabled、权限仍有效时以同一 ID re-arm；
  迟到 native schedule promise 会再次触发确定性 ID 清理；
- emergency disable 先提升本地撤销 epoch，再清理所有活动 timer。已进入原生调度 commit 但无法证明
  清理的路径返回非 retryable `timer_schedule_status_unknown` / `timer_cancel_status_unknown`，不冒充成功。

Android 12+ 在没有 exact alarm 权限时由系统决定调度精度；本仓库继续禁止 exact alarm、boot receiver、
FCM/APNs 与 remote-notification。进程被杀不等于设备 reboot：系统 pending 可能继续存在，但 Android reboot
后不会自动恢复。当前 unit/component/local contract 不证明双端真机前台、后台、锁屏、Doze、reboot、
到点取消竞态或实际呈现。

后续候选：

- `reminder_create`：仅在数据归属和系统 API 行为确定后加入；
- `calendar_event_draft`：只创建草稿或跳系统确认，不静默写系统日历。

### `phone/apps`

当前本地实现注册 `can_open_url` 与 `open_url`：两者只接受非秘密构建变量
`EXPO_PUBLIC_LINK_HOSTS` 中的精确 HTTPS hostname；不接受自定义 scheme、HTTP、内嵌凭证、IP
literal、非 443 端口或 fragment。`open_url` 仅在前台可用，确认 UI 显示调用方和脱敏 hostname；
系统接受 handoff 后只返回 `{ status: 'handed_off', target: { kind: 'https', host } }`，结果和普通审计
不包含完整 URL/query。`can_open_url` 是无副作用读取，不能批量枚举已安装 App。

这里的“内嵌凭证”特指 URL `userinfo`。query 由调用方原样交接但不会进入普通审计；支付、身份认证、
通信或系统设置 hostname 在专用 risk/path policy 实现前不得加入通用 allowlist。`canOpenURL` 最多等待
5 秒，并受 command deadline/取消约束；`open_url` 在系统 handoff 提交点前再次检查取消和到期。

#### `open_url`

- 只允许 `https` 和本地已配置的 scheme/host allowlist；
- 支付、系统设置、通信和身份认证类深链需要额外确认；
- 锁屏或后台无法打开 UI 时返回 `awaiting_user` 或 `foreground_required`；
- 结果 `handed_off` 只说明系统接受了打开请求，不说明第三方 App 内任务完成。

#### `can_open_url`

只回答某个允许查询的 scheme 是否可打开；不得用它批量枚举用户安装的 App。

## 6. P1：位置

### `phone/location`

| 工具 | 结果 | 确认与权限 |
| --- | --- | --- |
| `current` | 坐标、水平精度、采集时间、权限精度 | high risk；每次本地确认；仅 foreground/when-in-use 权限 |
| `open_map` | handed_off | 打开地图前按策略确认 |

`current` 不接受无限精度承诺。建议结果：

```json
{
  "coordinate": {
    "latitude": 31.2304,
    "longitude": 121.4737
  },
  "horizontalAccuracyMeters": 24,
  "capturedAt": "2026-08-19T03:00:00Z",
  "mocked": false,
  "permissionAccuracy": "approximate"
}
```

当前已实现 `current`：strict 入参要求 `purpose`（1–120 字符）、`balanced | high` 和 5–30 秒 timeout；
确认页显示调用方、用途、期望精度和最长等待。真实 probe 检查 App 前台、系统位置服务与 foreground
permission；允许一次后才按需请求权限并采集首个 fix。超过 30 秒或未来偏移超过 5 秒的 fix 返回
`stale_location`，拒绝、服务关闭、取消、timeout 与 native failure 均不是成功。普通审计不保存坐标。
实际 location 等待还会截断到 command `expiresAt` 的剩余时间；deadline 到达时返回 `expired`，不会把
迟到 fix 写成成功。

当前也已实现 `open_map`，它不读取设备位置或请求位置权限。strict 入参只接受：

```ts
type OpenMapArguments = {
  purpose: string // 1–120，拒绝 control/bidi
  target:
    | {
        kind: 'coordinate'
        latitude: number // -90..90
        longitude: number // -180..180
        label?: string // 1–80，拒绝 control/bidi
        zoom?: number // integer 2..21
      }
    | { kind: 'query'; query: string } // 1–200，拒绝 control/bidi
}
```

caller 不能提供 URL、scheme、hostname 或 provider。App 本地按平台生成固定的 Android `geo:` URI 或
`https://maps.apple.com/` link，所有 query 都严格编码；Android manifest 只查询能处理 `geo` 的
`ACTION_VIEW` handler，不枚举具体 package。执行固定 `confirmation: always`、前台限定和 5 秒 handler
probe/deadline，确认页显示 purpose、目标摘要和 provider；成功只返回
`{ status: 'handed_off', target: { kind: 'map', provider } }`，不回显坐标/query，也不声称地图内任务完成。
格式依据 [Android common intents](https://developer.android.com/guide/components/intents-common#Maps) 与
[Apple Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html)；实际系统 handoff 仍需双端真机验收。

平台配置只包含 Android coarse/fine foreground location 与 iOS When In Use purpose string，不包含
background/Always/location foreground service/motion。后台持续定位和地理围栏属于 P2，必须另行评审
耗电、常驻可见性和商店政策。自动化证据不替代双端真机验收。

## 7. P1：相机

### `phone/camera`

#### `capture_photo`

建议入参：

| 字段 | 类型 | 限制 |
| --- | --- | --- |
| `facing` | `front \| back` | 默认 back |
| `quality` | `low \| medium \| high` | 默认 medium |
| `purpose` | string | 必填，展示给用户 |
| `expiresInSeconds` | integer | 60–3600 |

标准流程：

1. 命令到达后进入 `awaiting_user`；
2. 通知/前台页面展示调用方和 purpose；
3. 用户打开可见预览并确认；
4. App 拍摄、移除不需要的元数据、计算校验和；
5. 上传到网关签发的短期对象地址；
6. 结果只返回引用：

```json
{
  "objectRef": "tb-object://device/phone_a1b2/obj_01",
  "mimeType": "image/jpeg",
  "width": 1920,
  "height": 1080,
  "sha256": "…",
  "expiresAt": "2026-08-19T04:00:00Z"
}
```

安全约束：

- `effect: write`、`risk: high`、`confirmation: always`；
- App 在后台或锁屏时不得静默开始相机；
- 预览和系统相机指示器不可隐藏；
- 默认删除 EXIF 位置；确需保留必须在确认页单列；
- 上传失败后临时文件有限期保留并可由用户删除。

### P2 相机能力

- `scan_code`：本地解析二维码/条码，优先返回文本；
- `capture_clip`：用户持续按住/明确确认的短视频；
- `live_session`：WebRTC 实时会话，只建立经用户确认的临时流。

## 8. P2：通信、传感器与附近设备

这些能力只作为方向，不进入 MVP 承诺。

### `phone/communication`

- `compose_message`：打开系统编辑界面并预填，不静默发送；
- `dial`：打开系统拨号确认，不后台拨打；
- 不读取第三方消息数据库，不绕过系统 UI。

### `phone/sensors`

- 设备方向、加速度、环境传感器按需短时采样；
- 返回采样窗口和频率；
- 高频采样必须有时长上限并在前台可见。

### `phone/nearby`

- 蓝牙/NFC/局域网发现需单独权限和隐私评审；
- 只返回完成任务所需的最小发现结果；
- 不作为通用设备扫描器。

## 9. 永不作为普通 Tool 暴露的能力

- 任意 shell；
- 任意文件系统；
- 任意 Intent / URL Scheme；
- 无提示截图、相机或麦克风；
- 系统权限授予、设备解锁、DND 绕过；
- 静默发送消息、静默拨号、支付确认；
- 安装/卸载 App；
- 抹除、锁定或恢复出厂设置。

若未来组织设备场景确实需要其中某项，必须成为独立产品模式和协议 profile，不得通过给普通
consumer App 增加隐藏参数实现。
