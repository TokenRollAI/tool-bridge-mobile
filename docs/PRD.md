# PRD：Tool Bridge Mobile

状态：已决定的产品基线；P0 本地安全运行时部分实现，网关闭环未实现

目标版本：MVP / P1

更新时间：2026-08-19

## 1. 产品定义

Tool Bridge Mobile 是 HTBP 生态的移动设备执行端。用户将自己的手机与 Tool Bridge 网关配对后，
Agent 可以发现这台设备当下真实可用的能力，并在权限、确认策略和平台限制内调用。

产品价值不是再做一个聊天入口，而是让 Agent 的“手”伸到真实设备：

- Agent 可以让手机发出声光振动，帮助用户定位设备；
- Agent 可以控制本 App 的媒体播放，或经用户许可打开系统/第三方 App；
- Agent 可以请求手机提供相机、位置和传感器信息；
- Agent 可以把跨设备任务落到本地提醒、通知和深链；
- 所有动作都有明确的设备身份、权限边界、执行状态和审计记录。

## 2. 问题

现有 Agent 通常面临三层断点：

1. **只能调用云端服务**：无法使用用户身边手机的摄像头、扬声器、振动器、位置等硬件。
2. **设备状态不可见**：Agent 不知道手机是否在线、锁屏、静音、权限被撤回或能力受系统限制。
3. **远程命令不等于完成**：手机离线、App 被挂起、用户未确认时，调用需要排队、过期或被拒绝，
   不能简单用一次同步 HTTP 请求表达。

## 3. 目标用户

### 3.1 个人用户

已在使用 Tool Bridge Agent，希望 Agent 能协助处理跨设备日常任务，同时要求隐私和控制权清晰。

### 3.2 开发者与自动化作者

希望用统一 HTBP 工具树调用手机能力，不分别集成 APNs、FCM、Android Intent、iOS URL Scheme
和各类硬件 API。

### 3.3 团队设备场景（后续）

经组织策略注册的测试机、展厅设备或现场采集设备。MVP 不提供 MDM，也不因团队场景放宽用户确认。

## 4. Jobs to be Done

### JTBD-1：找手机

当我找不到手机时，我希望 Agent 能让指定手机以可辨识的方式响铃、振动和闪灯，这样我不需要
登录另一个厂商账户或盲目翻找。

### JTBD-2：把内容送到手机

当 Agent 已找到一首歌、一个地址或一个链接时，我希望它能在我的手机上播放或打开，而不是只在
对话里给我一个 URL。

### JTBD-3：把手机当作 Agent 的眼睛

当我需要远程排障或识别身边物体时，我希望 Agent 能请求一张照片；我确认并对准目标后，照片作为
短期对象引用返回给 Agent。

### JTBD-4：让任务在合适的设备发生

当任务与时间、地点或注意力相关时，我希望 Agent 在手机本地设置提醒或导航，让任务不依赖当前
聊天会话保持在线。

## 5. 产品原则

1. **Agent 请求，设备裁决**：网关鉴权通过不代表设备必须执行；设备是最后一道策略执行点。
2. **状态优先于幻想**：工具目录必须反映当前平台、权限、前后台和用户模式。
3. **渐进授权**：用户使用某类能力时再申请对应系统权限。
4. **有副作用就可见**：响铃、拍照、录音、持续定位等动作必须在设备 UI 和审计记录中可见。
5. **异步是一等公民**：离线与等待用户确认不是异常边角，而是标准命令状态。
6. **不突破操作系统边界**：不承诺系统不允许的后台相机、跨 App 任意控制或绕过锁屏。

## 6. MVP 范围

### 6.1 P0：运行时基础

- 生成并安全保存稳定的本地 `installationId`；配对成功后再接受网关签发的 `deviceId`；
- 内测阶段允许用户在本机手工填写 Gateway HTTPS origin 与 API key，使用派生的客户端 `deviceId`
  建立前台连接；该入口不冒充配对、设备凭证签发或最小权限授权；
- 通过一次性配对流程获得最小权限设备凭证；
- 前台建立设备 WebSocket，会话断开后指数退避重连；
- 上报静态与动态能力；
- 接收调用、执行策略判断、返回结构化结果；
- 本地调用记录和紧急停用开关；
- push token 注册、命令邮箱拉取与幂等执行；
- 明确展示 online / background-reachable / offline / disabled。

### 6.2 P1：首批用户能力

| 场景 | MVP 工具 | 结果 |
| --- | --- | --- |
| 找手机 | `phone/attention.ring`、`stop` | 响铃会话和最终状态 |
| 设备状态 | `phone/status.get` | 电量、网络、权限摘要、可达性 |
| 播放媒体 | `phone/media.play/pause/resume/seek/stop/status` | 本 App 播放状态 |
| 本地运行时 | `phone/runtime.capabilities/pending_commands/cancel` | 当前 credential principal 范围内的安全元数据与取消请求 |
| 打开内容 | `phone/apps.open_url`、`phone/location.open_map` | 已打开/等待用户/拒绝 |
| 本地通知 | `phone/productivity.notify` | 通知标识和系统调度状态（不等于展示或点击） |
| App 内计时器 | `phone/productivity.timer_start/timer_cancel/timer_status` | SQLite 状态和系统 pending 观察（不等于准时展示） |
| 相机协作 | `phone/camera.capture_photo` | 经本地确认后的短期对象引用 |
| 单次位置 | `phone/location.current` | 经授权的坐标、精度和时间 |

### 6.3 Android 优先

首个端到端切片优先在 Android 真机完成，因为 Android 对通知通道、前台服务、媒体会话和 Intent
提供更丰富的可验证控制面。iOS 工程从 P0 即存在，并对共有能力保持协议一致；iOS 不支持的行为
返回结构化平台限制，而不是模拟成功。

## 7. 非目标

MVP 明确不做：

- 通用远程桌面、屏幕共享或任意 App UI 自动化；
- 绕过锁屏、静音/DND、系统权限或企业策略；
- 后台隐藏拍照、录音或连续视频监控；
- 读取短信/即时通讯内容、静默拨号或静默发消息；
- 将照片、音频、视频直接编码进 HTBP JSON 帧；
- 以设备 SK 充当用户管理 SK；
- MDM、家长控制、反盗窃锁定或抹除；
- 在 App 中内嵌通用 Agent 对话 Dashboard；
- 把浏览器插件合并进本仓库。

## 8. 功能需求

### FR-1：配对与撤销

- App 通过扫码或短码消费一次性 pairing session；
- pairing session 必须短期有效、单次使用并绑定目标网关；
- 成功后签发设备专用最小权限凭证；
- 用户可在 App 内查看配对网关、重新命名设备并立即撤销；
- 网关撤销后，设备下一次请求必须失败并清除本地会话；
- 日志与界面不得展示完整凭证。

现状：正式 pairing/rotation/revoke 仍未实现。为便于内测，首页提供独立的手工 URL + API key 入口；
URL 必须是纯 HTTPS origin，API key 只进入 SecureStore，保存后表单立即清空。App 从随机本地
`installationId` 派生 `mobile_<uuid>` 作为客户端声明的协议 deviceId。此 fallback 不能用于验收上述
pairing、设备专用最小权限凭证或撤销条目，产品发布前仍需回到正式流程。

### FR-2：设备状态

- 展示连接状态、最后在线时间、push 可达性和当前控制模式；
- Agent 可读取非敏感状态摘要；
- 电量、网络、锁屏等字段若平台不可提供，必须逐字段标记 unavailable；
- 权限变化后立即刷新 capability profile。

### FR-3：能力声明

- 每个工具声明名称、描述、输入/输出 JSON Schema、effect、确认策略和平台约束；
- capability profile 由实际探测产生，而不是仅由 OS 名称静态生成；
- 权限被撤销、App 进入后台或控制模式变化时，网关最终可观察到能力变化；
- Agent 调用过期能力时，返回可操作的结构化错误。

### FR-4：命令生命周期

标准状态：

```text
queued -> delivered -> awaiting_user -> running -> succeeded
                                      \-> rejected
       \-> expired
       \-> cancelled
                         running -> failed
```

- 所有命令有全局唯一 `commandId`、创建时间和过期时间；
- 同一 `commandId` 最多产生一次外部副作用；
- 客户端重试只能回放首次结果，不能重复响铃、通知或拍照；
- 前台 SDK 调用可查询同一 credential principal 的本地活动/等待确认摘要并请求取消；这不是后台 mailbox，
  也不能冒充具体 Agent 归因；
- 过期或取消后不得开始新的副作用。

### FR-5：找手机

- Agent 可指定持续时间、振动和闪灯偏好；
- App 显示高优先级可见通知或全屏交互（以平台允许为准）；
- 用户可从设备上立即停止；
- 命令到期自动停止；
- DND、音量和平台政策导致不能播放时，结果必须说明实际生效的通道；
- 设置每设备、每调用方和全局速率限制。

### FR-6：媒体

- MVP 只保证控制本 App 管理的播放会话；
- `play` 接受受信 URL 或网关对象引用，不接受任意本地文件路径；
- 受信 URL 必须在创建 player 前重验 redirect/最终来源、音频 MIME 与实际大小，并下载到 App 私有
  临时文件；直播、无效时长和超过 2 小时的媒体必须在播放前拒绝；网关对象引用等待上游受保护的
  正式契约；
- 返回当前媒体、播放状态、位置和可用控制；
- 打开第三方音乐 App 走受控深链并返回“已交接”，不声称能持续控制；
- 后台播放必须使用平台正规媒体会话和可见控制。

### FR-7：相机

- 首次调用前解释目的并申请系统相机权限；
- 每次远程拍摄默认需要用户在前台确认；
- 相机预览可见，用户主动按下拍摄/确认；
- 结果上传对象存储，只返回 `objectRef`、MIME、尺寸、校验和和过期时间；
- 用户取消、权限拒绝、后台状态和锁屏状态分别返回不同错误；
- 临时文件上传成功或过期后按策略删除。

### FR-8：位置

- MVP 仅提供一次性当前位置和打开地图；
- 打开地图只接受结构化地址/坐标，由 App 本地构造平台目标并逐次确认；结果只表示系统接受 handoff，
  不回显目标或声称地图内任务完成；
- 返回坐标必须包含采集时间、精度和来源；
- 位置权限按使用时申请；
- 持续/后台定位不进入 MVP，后续必须单独评审用户价值、耗电与商店政策。

### FR-9：本地通知与深链

- 本地通知的正式路径为 `phone/productivity.notify`，当前只接受 `purpose` 与 `message`；调用方不能
  指定标题、URL、data、action、声音、badge 或未来调度时间；
- OS 通知标题固定为 `Tool Bridge`，正文带固定 `Agent 通知：` 前缀；caller 与 purpose 只在 App 的
  本地确认界面展示，不能借通知正文伪装系统或其他调用方；
- 通知系统权限只由用户在 App 内的说明页面主动触发；远程命令不会弹系统授权框；
- 本地即时通知只在 App 前台、系统授权和 Android channel 可用时声明 available；当前结果只报告
  原生调度请求已返回 `scheduled` 与 `presentation: system_determined`，不把它写成已展示或已点击；
- 通知频率受 caller/global admission 约束；同一 `commandId` 只调度一次，消息正文不进入普通审计
  或持久化 command outcome；
- 深链 scheme/host 和执行频率受 allowlist/策略约束；
- 高风险 scheme、设置页和可能发起支付/通信的深链默认拒绝；
- 通知交付与用户点击是不同状态；
- 当前本地通知不注册 push token、不接 mailbox，也不代表 U-6 远程 push 已实现。
- App 内计时器只接受规范 UTC `firesAt` 与用于本地确认的 `purpose`；创建时目标必须在 10 秒至 24
  小时内，不接受 caller 提供的 label/message/title、repeat、URL、data、action、sound、badge 或 channel；
- 计时器以 SQLite v2 状态为真源，系统绝对 DATE trigger 只是 best-effort 可见提示。固定 payload 为
  `Tool Bridge / Agent 计时器已到期`，purpose 不进入 SQLite、原生 payload、command outcome 或普通审计；
- `timerId` 与 native identifier 都由 source `commandId` 的 SHA-256 确定性派生；活动容量由 SQLite
  事务限制为每 caller 8、全设备 32，进程重启不能重置该容量；
- `timer_status` 和 `timer_cancel` 只允许同一 caller 访问，不存在与异主统一返回 `not_found`；本地 UI
  始终可以取消，Disabled 会清理所有活动 timer；
- start 只报告系统接受 schedule；status 只区分 pending observed、missing、deadline elapsed、cancelled
  或 unknown；cancel 也保留 `presentation: unknown`。任何结果都不声称 fired、delivered、presented、
  clicked、on-time 或从未展示；
- 当前构建继续禁止 boot receiver 与 exact alarm。Android 设备 reboot 后系统 pending 不恢复；App 下次
  主动进入前台时只对成功、未到期且仍获授权的 timer 用同一标识对账，crash orphan 一律清理而不重放。

### FR-10：本地控制台与审计

- 首页展示当前模式、网关、设备名、连接状态和总开关；
- 首页允许本机保存或清除 Gateway HTTPS origin + API key；清除前二次确认并先停止当前连接，API key
  不回显，也不进入普通审计、SQLite 或可公开构建变量；
- 能力页逐项展示权限、确认策略和平台限制；
- 活动页展示最近调用的时间、来源、工具、effect/risk、决策和结果；
- 活动页只投影最近 100 条，本机审计持续硬限制为 5,000 条；
- 用户可在不可恢复的范围确认后只清除本机活动审计；该操作不取消命令，也不删除 command 防重放
  记录、计时器、设置、installation identity 或凭证，清除后发生的调用继续记录；
- 控制台不只用颜色表达状态，支持系统字号换行；页面/卡片标题、状态 label/value 与操作均提供明确
  语义，重复操作使用不泄漏 message/purpose 等正文的唯一上下文名称；
- 离散、可操作状态变化可被读屏器公告；倒计时、播放进度和敏感确认详情不得形成高频或自动公告；
- 用户可停止进行中动作；撤销网关和完整本地数据删除仍按独立流程验收；
- 审计默认不包含媒体内容、精确位置、凭证或完整消息正文。

当前本地活动页和仅审计清除已实现；它不是服务端安全审计、网关撤销或账户级数据删除。清除失败时
页面保留现有投影并报告失败，不把未知删除结果显示成成功。无障碍语义当前有 common RN 自动化与
Android emulator 200% 字号 smoke；TalkBack/VoiceOver/Switch Access 和 iOS Dynamic Type 仍需平台验收。

## 9. 控制模式

| 模式 | 行为 |
| --- | --- |
| Disabled | 不连接、不接收 push、不执行命令 |
| Ask every time | 所有有副作用工具都在设备上确认 |
| Trusted session | 指定时限内允许一组已授权低/中风险工具 |
| Policy managed | 依据本地签名策略执行；MVP 只预留，不启用 |

首次配对后默认 `Ask every time`。任何模式都不能覆盖系统权限与平台限制。相机、麦克风和高精度
持续定位不得因 trusted session 静默执行。

## 10. 成功指标

MVP 发布前以质量指标为主，不以调用量驱动扩大权限：

- 在线低风险命令端到端成功率 ≥ 99%（测试环境、排除平台明确拒绝）；
- 已送达设备的命令状态最终一致率 = 100%；
- 同一 `commandId` 重放 100 次只产生一次副作用；
- 用户从“找手机”请求到设备开始提示的 P95：
  - 前台在线 ≤ 2 秒；
  - 后台可达 ≤ 10 秒（不把 OS 未送达算作成功）；
- 权限拒绝、离线、过期、用户取消均无假成功；
- 敏感字段扫描在日志与崩溃产物中零命中。

## 11. 关键产品风险

| 风险 | 处理 |
| --- | --- |
| 用户把它理解成隐形遥控/监控 | UI 明示、能力分级、相机本地确认、非目标写入商店描述 |
| iOS 后台唤醒不可靠 | 命令邮箱 + push 提示，不承诺实时；展示 last delivery |
| Android 后台敏感权限限制 | 通过可见 Activity/通知交互进入前台后再执行 |
| 音乐“播放”语义过宽 | MVP 只承诺 App 自有播放器；第三方仅深链交接 |
| 重试造成重复副作用 | commandId、持久化去重和首次结果回放 |
| 设备凭证权限过大 | 单设备、单挂载、可撤销、短期配对票据 |
| 能力目录与实际状态漂移 | 动态探测、变更上报、执行前二次策略检查 |

## 12. 发布判定

只有 [DOD](DOD.md) 的仓库、协议、功能、安全、双端和发布闸门全部满足，才能把状态从
“规划”改为 “MVP”。单个演示视频、模拟器成功或同步 WebSocket happy path 不构成完成。
