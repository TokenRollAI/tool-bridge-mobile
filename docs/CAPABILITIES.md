# 移动端能力目录

状态：产品提案，除“当前协议可表达”标记外均不代表已经实现。

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

## 2. P0：运行时与状态

### `phone/status`

#### `get`

用途：让 Agent 在执行前了解设备可达性和约束。

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
| `capabilities` | 返回当前能力 profile 与版本 | low | P0 |
| `pending_commands` | 返回仍在等待确认/执行的命令摘要 | low | P0 |
| `cancel` | 取消尚未开始或可中断的命令 | medium | P0 |

## 3. P1：注意力与找手机

### `phone/attention`

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

#### `stop`

停止指定 `sessionId` 或本设备全部找机提示。设备本地停止按钮优先级最高。

#### `notify`

发送一条可见的本地通知。它与 `productivity.notify` 最终可能合并；在正式协议确定前不得同时
实现两个行为不同的重名能力。

安全：

- 按调用方和设备限流；
- 不允许下载远程声音作为提示音；
- 不承诺突破系统 DND / 静音策略；
- 命令过期立即停止；
- `ring` 为 `effect: write`，默认允许 trusted session，但用户可改为每次确认。

## 4. P1：媒体

### `phone/media`

| 工具 | 主要入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `play` | `source`、`title?`、`startAtMs?` | playback session | 播放受信 URL 或 objectRef |
| `pause` | `sessionId?` | 当前状态 | 暂停本 App 会话 |
| `resume` | `sessionId?` | 当前状态 | 恢复本 App 会话 |
| `stop` | `sessionId?` | stopped | 停止并释放资源 |
| `seek` | `positionMs` | 当前状态 | 仅媒体支持 seek 时 |
| `status` | 无 | 当前媒体和控制能力 | read |

`source` 必须是以下之一：

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

后续候选：

- `reminder_create`：仅在数据归属和系统 API 行为确定后加入；
- `calendar_event_draft`：只创建草稿或跳系统确认，不静默写系统日历。

### `phone/apps`

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
| `current` | 坐标、水平精度、采集时间 | 位置权限；默认本地确认 |
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
  "permission": "while_in_use"
}
```

后台持续定位和地理围栏属于 P2，必须额外展示耗电和常驻状态。

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
