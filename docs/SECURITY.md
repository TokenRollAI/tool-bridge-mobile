# 安全、隐私与平台约束

状态：实现必须遵守的安全基线。

当前原生配置包含：Android 普通权限 `android.permission.VIBRATE`，以及 P1-B 可见媒体播放所需的
`FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 与非导出的 `AudioControlsService`；
iOS 新增 `audio` background mode。一次性位置只声明 Android coarse/fine foreground location 和 iOS
`NSLocationWhenInUseUsageDescription`；没有 `ACCESS_BACKGROUND_LOCATION`、location foreground
service、Always location 或 motion 权限。即时本地通知在 Android 声明 `POST_NOTIFICATIONS`，但显式
排除 boot 恢复、exact alarm、C2DM 与厂商 badge 权限，并从最终 manifest 移除 FCM
service/receiver/provider 与 Firebase transport 初始化入口；iOS 不保留 `aps-environment` entitlement，也不启用
`remote-notification` background mode。未声明相机、麦克风、Face ID 或后台录音权限。
haptic capability 仍需 native hardware probe、本地 policy 和 session TTL；媒体执行还需 HTTPS
hostname allowlist、受控下载、单会话控制与系统可见媒体控制。权限/entitlement 存在本身不构成
执行授权。

Expo 模块的 Android manifests 默认可能合并 legacy external storage、debug overlay、`USE_BIOMETRIC`
与 `USE_FINGERPRINT`；当前 App 不需要这些能力，也未对 credential/identity 使用
`requireAuthentication`。因此 `app.config.ts` 显式 block 五项，并由本地 config plugin 清理
development debug manifest 的 overlay 声明；配置 introspection 与安装后 `dumpsys package` 都必须
证明它们未进入最终 App。

当前本地确认队列最多 10 条，并以根布局 Modal 覆盖所有标签页，优先显示最早一条及安全挑选的确认
详情；它不持久化完整参数。批准只对单个 commandId
有效；executor 在批准后重新执行过期、取消、probe 和 Disabled 检查。并发重复 commandId 共用同一
in-flight Promise，避免确认后出现第二个副作用。确认页、系统媒体 metadata 等用户可见远端文本会在
schema 层拒绝 C0/C1 control 与 bidi override/isolate 字符，避免方向覆盖伪装系统文案。

每个本地 capability 都声明 caller/global 滑动窗口和 inline JSON 结果字节上限。executor 在 probe 与
confirmation 前 admission，防止先塞满确认队列；SQLite claim 返回后再复检取消/到期。command
deadline 会截断 attention session 和 location wait，emergency disable 会 abort 进行中 handler。
这些窗口当前在进程重启后重置，因此不替代上游账户/设备配额。

`phone/runtime.pending_commands/cancel` 只能观察或取消同一 gateway credential principal 的本地活动
命令，不返回 arguments、确认正文或结果，也不泄露其他 principal 是否存在目标 commandId。当前 SDK
没有具体 Agent caller，因此 UI、审计和工具结果均不得把这一边界描述成 per-Agent ownership。

attention 内置提示音是 App 本地生成的固定短 WAV，只写 App 私有 cache，不接受 URL/objectRef 或远端
音频字节。播放请求明确不启用 silent-mode bypass，也不声称越过 DND；flash 仍未实现，App 不为其声明
Camera 权限。

command 防重放记录不能只在 App 启动时清理：每次从 running 写入终态都与 retention prune 共用同一
SQLite exclusive transaction，终态总数持续限制为 10,000 条。裁剪按 receivedAt/commandId 淘汰最旧
可删记录，但保留所有 running、当前刚完成的 command，以及状态为 preparing/scheduled/cancelling/
status_unknown 的活动 timer source command；否则可能在结果刚写入或 timer 仍需对账时恢复旧命令的
副作用执行资格。启动恢复仍保持 command recovery → timer reconciliation → terminal prune 的顺序。

App handoff 与媒体分别使用独立 hostname allowlist。两者都在本地确认前拒绝 HTTP、凭证、非标准
端口、fragment、IP literal 与未知 hostname；普通审计只记录 capability 元数据。系统接受
`openURL` 只代表 `handed_off`，不能升级为第三方 App 内任务成功。

通用 App handoff 所谓“凭证”指 URL `userinfo`；query 不写入普通审计，但会原样交给目标 App，因此
支付、认证、通信或系统设置目标在专用 path/risk policy 交付前不得进入通用 allowlist。Linking handler
probe 最多等待 5 秒，并在系统打开提交点前重查 command 取消与到期。

地图 handoff 不接收 caller URL/scheme/provider，只接收 strict 结构化地址或坐标；本地 builder 固定
Android `geo:` 或 Apple Maps HTTPS link 并严格编码参数。它固定逐次确认、只在前台执行，结果/普通审计
不回显地址、坐标或 query。Android 只声明 `geo` `ACTION_VIEW` query visibility，不指定或枚举某个地图
package；该 query 不是位置权限。

HTTPS 媒体下载不携带 cookies/HTTP credentials，禁用自动 redirect 并逐跳重验 allowlist；最终
response URL 也必须通过相同策略。resolver 同时校验音频 MIME allowlist 与字节签名，并分别以
`Content-Length` 和实际流式读取执行 25 MiB 上限。内容只写入 App 私有 cache；失败、取消、timeout、
播放停止及下一次 cache 初始化都会清理，player 不接收远程 URL。完整 URL/query 和私有 `file://`
路径都不进入普通审计。player 最多等待 10 秒取得 metadata，并在任何 `play()` 前拒绝直播、无效时长
及超过 2 小时的媒体。该边界不代表已支持上游 `objectRef` 或其 TTL。

`phone/location.current` 是 high-risk read 并固定 `confirmation: always`。确认页只投影调用方、用途、
期望精度和最长等待；在用户允许一次之前不请求系统权限、不启动位置订阅。批准后 executor 会重新
检查过期、取消、前台状态、系统服务、动态权限与 Disabled policy。订阅在首个 fix、取消、timeout
或 native error 时立即移除；普通 audit 只记录能力和裁决元数据，不记录坐标。

`phone/productivity.notify` 只接受 strict purpose/message，并拒绝控制字符、bidi 与任何 title、URL、
data、action、sound、badge 或 schedule 字段。OS 标题固定为 `Tool Bridge`，正文固定带
`Agent 通知：` 前缀；caller 与 purpose 只在 App 本地确认 UI 中展示，避免远程文本伪装系统来源或
泄漏 subjectId。前台 handler 只展示 `tb_local_notify_` / `tb_local_timer_` 加 commandId SHA-256 的两类
精确 identifier，其他未来 remote notification 默认抑制。权限请求只能由首页本地按钮触发；远程 probe
遇未授权、App 后台
或 Android channel 关闭均返回 unavailable。caller/global admission 为 5/10 次每分钟，消息正文不进
command outcome 或普通 audit；成功只表示原生 schedule promise 返回，不表示展示、阅读或点击。
Android fresh install 可能由 Expo 表达为 `denied + canAskAgain=true`；本地 adapter 将这种仍可由用户
请求的状态与永久拒绝分开，前者显示教育/请求按钮，后者只给系统设置入口，远程调用两者都不能改变。

App 内 timer 只接受 canonical UTC `firesAt` 与确认用 purpose。purpose 不进入 SQLite、原生固定通知、
command outcome 或普通 audit；caller 只能 status/cancel 自己创建的 timer。SQLite reserve 在事务中执行
8/caller、32/device 活动容量，重启不会重置。`preparing/scheduled/cancelling/status_unknown` 与 source
command 一起对账：未知 crash source 一律清理，不凭 timer 行重放；迟到 schedule promise、emergency
disable epoch 或 cancel 失败都必须走确定性 identifier 补偿，无法证明清理时返回 unknown。系统 DATE
trigger 不等于准点、呈现或送达；构建继续移除 boot/exact/FCM/APNs。

## 1. 威胁模型

需要防御：

- pairing 二维码被截获或重复使用；
- 设备凭证从日志、URL、存储或崩溃报告泄漏；
- 合法 Agent 被授予超过任务需要的能力；
- 网关或客户端重试导致重复副作用；
- 恶意参数触发任意 URL、文件访问、超大上传或资源耗尽；
- push payload 泄漏任务内容；
- 设备丢失后原配对仍可远程操作；
- 能力目录显示安全，但执行时权限/前后台状态已变化；
- 远程调用伪装成系统提示诱导用户；
- 供应链依赖或 native module 越权读取数据。

不假设：

- 网关鉴权通过就代表用户同意当前动作；
- push 必达；
- WebSocket 常驻；
- 手机系统会允许 App 突破静音、锁屏或后台限制；
- 设备本地数据库永远不会被物理攻击者读取。

## 2. 信任边界

```text
Agent credential
      |
      v
Tool Bridge Gateway ---- APNs / FCM
      |                       |
      v                       v
Device credential ---- Mobile Runtime
                          |
                    Local Policy + User
                          |
                     Native Capability
```

- Agent credential 只证明调用方；
- device credential 只证明某个已配对设备；
- push provider 只传递提示，不承载授权；
- Local Policy + User 才决定是否在此时执行；
- Native Capability 必须再次依赖系统权限。

## 3. 凭证

### 3.1 设备凭证

- 每台安装实例独立；
- 限定 gateway audience、deviceId、mountPath 和设备操作；
- 不具备用户/管理员管理权限；
- 可撤销、可轮换；
- 通过 SecureStore 或更强的 Keychain / Keystore-backed native module 保存；
- 不进入 AsyncStorage、SQLite、剪贴板、deep link、push、analytics；
- UI 最多显示 keyId 和尾部指纹。

当前 `@tool-bridge/sdk/device@0.11.0` 原生 RN 路径每次连接从 SecureStore 重新读取 envelope，要求
`audienceOrigin` 与当前选中的 HTTPS gateway origin 完全一致，再把 material 仅放入 WebSocket upgrade
Authorization header；secret 不进入 URL。deviceId/keyId 拒绝控制与双向覆盖字符，header material
拒绝 CR/LF。网关拒绝连接后客户端 fail closed 并清除本地 envelope。

pairing 交付前的内测 fallback 允许用户在本机手工输入 URL + API key：

- URL 只接受无 path/query/fragment/userinfo 的 HTTPS origin，可选构建预置也只能包含该非秘密值；
- API key 只接受无空白的可打印 ASCII token，输入框遮蔽，保存后立即清空，不进入 `.env`、
  `EXPO_PUBLIC_*`、SQLite、普通审计、日志或 crash report；
- 保存先关闭旧 transport，再写 SecureStore，最后连接新 audience；写入失败时保持关闭；
- 清除先关闭 transport，再删除 SecureStore key；删除结果未知时不得重新使用旧 key；
- 客户端 deviceId 默认由设备硬件标识（Android ID / iOS IDFV）加域分隔盐经 SHA-256 单向摘要截断派生，
  原始硬件标识不进入协议、存储或日志；用户自定义 deviceId 只接受 `[A-Za-z0-9._-]{1,64}`；
  `manual_api_key_<uuid>` principal 从随机 installation identity 派生。两者只是
  客户端路由/本地归因，不是网关签发身份或具体 Agent caller；
- 手工长期 API key 可能拥有比设备专用凭证更大权限，不能作为正式 pairing、最小 scope、rotation、
  revoke 或 U-3 短期 ticket 的发布替代品。

0.11.0 call 尚未把 Agent caller identity 传到设备；当前本地审计只能把 credential `keyId` 记作 gateway
principal。它不能证明具体 Agent，相关 UI/审计不得作更强归因。

### 3.2 WebSocket ticket

状态：U-3 目标，当前 0.11.0 原生 RN transport 使用既有 device credential header，不等于短期 ticket。

- 单次使用；
- 短 TTL；
- 绑定 deviceId、session nonce 和 audience；
- 消费后不可重放；
- 服务端日志对 query 和 ticket 脱敏；
- ticket 不能用于 HTTP mailbox 或管理 API。

### 3.3 Push token

push token 是敏感设备标识：

- TLS 传输；
- 服务端加密/受控存储；
- 轮换时原子更新；
- provider 返回 invalid token 时失效；
- 撤销配对时删除；
- 不出现在普通日志或分析事件。

## 4. 授权层

一次调用必须连续通过：

1. Agent SK 的树路径权限；
2. 网关对设备/mountPath 的路由权限；
3. device credential 的连接与 mailbox 权限；
4. capability profile 声明；
5. 本地控制模式和工具策略；
6. 当前系统权限；
7. 前后台、锁屏、网络和硬件条件；
8. 需要时的本地用户确认。

任一层拒绝即不执行。下游层不能因为上游已允许而跳过。

## 5. 风险分级

| 等级 | 示例 | 默认策略 |
| --- | --- | --- |
| Low | 读取 App/连接状态、媒体状态 | 配对后可调用 |
| Medium | 本地通知、计时器、响铃、打开普通 HTTPS | Ask every time；trusted session 可配置 |
| High | 位置、相机、麦克风、通信深链 | 每次确认或前台明确交互 |
| Prohibited | 隐藏拍摄、任意 shell、绕锁屏、静默发送/拨号 | 不实现 |

`effect: read/write/destructive` 与风险等级是不同维度。读取精确位置虽然不写状态，仍是 high。

## 6. 用户确认

确认页至少展示：

- 谁在请求（调用方可验证名称/标识）；
- 请求哪项能力；
- 用途 `purpose`；
- 将收集/影响什么；
- 数据会发送到哪个网关；
- 结果有效期；
- 允许一次 / 拒绝；
- 对允许进入 trusted session 的能力，单独提供限时授权入口。

禁止：

- 模糊按钮如“继续”代替“拍摄并上传”；
- 在通知正文中模拟系统权限弹窗；
- 预选长期授权；
- 用户拒绝后自动循环弹出；
- 相机/麦克风确认与另一个无关操作捆绑。

## 7. 命令安全

- 所有 arguments 运行时 schema 校验，未知字段默认拒绝；
- commandId + 本地事务去重；
- 每条命令有 expiresAt；
- claim 和 result 都绑定 deviceId；
- 取消在开始副作用前必须生效；
- handler 有时长、次数和资源上限；
- URL、scheme、MIME、文件大小和媒体时长 allowlist；
- 错误对 Agent 返回稳定 code，不泄漏原生 stack；
- 网关时间与设备时间偏差要容忍，但不能无限延长过期命令。

## 8. 媒体与隐私数据

- 照片/音频/视频不进入普通日志、analytics 或 push；
- 默认移除照片 EXIF 位置；
- 临时文件放 App private storage；
- 上传 URL 单次、短期、限定大小与 MIME；
- 完成后校验 sha256；
- 对象引用受 Tool Bridge 权限保护并有 TTL；
- 用户能查看近期创建对象并提前删除；
- crash 后清理孤儿临时文件；
- debug build 也不能打印 base64、signed URL query 或精确位置。

## 9. 审计

记录：

- commandId；
- 时间；
- caller subject/key id 的非秘密标识；
- path/tool；
- effect/risk；
- policy decision；
- 用户确认/拒绝；
- 状态和结构化错误码；
- 客户端与协议版本。

默认不记录：

- 完整 arguments；
- SK/ticket/token；
- 照片/音频；
- 精确坐标；
- 联系人或消息正文；
- signed URL；
- 原生绝对文件路径。

每次新增本机审计都在同一 SQLite transaction 中裁剪，持续硬限制为 5,000 条；活动页只投影最近
100 条。用户可以在设备本地的 destructive confirmation 后清除当前 `audit_records`，DELETE 完成后
发生的新调用仍会保留。页面只展示 caller 非秘密 subject id、时间、path/tool、effect/risk、decision
与 outcome code，不展示 command arguments、完整 outcome、坐标、URL、message/purpose 或凭证。

清除审计绝不删除 `commands`：否则旧 `commandId` 可能再次产生副作用。它也不删除 timer、设置、
installation identity 或 credential，不取消进行中命令，也不冒充网关撤销、账户级数据删除或服务端
安全审计清除；这些流程必须独立定义和验收。清除失败时 UI 不显示成功；与新审计并发时，以 SQLite
DELETE 的线性化点为界，之后完成的记录可以保留。

本地控制台的可访问名称只组合非秘密状态元数据。timer/confirmation 等重复操作可以包含 caller 的
非秘密 subject/display label、tool 与时间以消除歧义，但不得把 message、purpose、地址、坐标、URL
或 command outcome 正文塞入自动公告。倒计时和媒体进度不做 live announcement，避免高频播报掩盖
拒绝、Disabled、错误等安全相关离散变化；视觉状态也不得只依赖颜色。

## 10. iOS 约束

### 后台

Apple 明确说明后台通知是低优先级、可能被节流且不保证送达；被唤醒后也只有有限执行时间。
因此：

- 不承诺离线命令即时执行；
- command 必须先进入 mailbox，push 只是提示；
- UI 区分 queued、push_sent、delivered；
- 用户强制退出 App 后，不承诺后台恢复；
- 找手机能力不能宣称等同系统级 Find My。

来源：[Apple：Pushing background updates to your App](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)。

### 相机与麦克风

- 系统要求用户明确授权并提供 usage description；
- App 进入后台时应释放相机等共享资源；
- 远程拍摄必须把用户带到可见前台流程；
- 不实现后台静默相机/麦克风。

来源：

- [Apple：Requesting authorization to capture and save media](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
- [Apple：Preparing your UI to run in the background](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background)

### 声音与注意力

- 遵守静音、专注模式、通知授权和系统音频会话；
- 不承诺强制突破 DND；
- 使用正常通知/音频能力，不能模拟系统级紧急警报权限。

## 11. Android 约束

### 后台启动与敏感权限

Android 对后台启动 foreground service 有限制；涉及 camera/microphone/location 的 while-in-use
权限时，后台启动尤其受限。因此：

- App 在后台收到相机命令时进入 `awaiting_user`；
- 通过可见通知让用户打开 Activity 后再访问相机/麦克风；
- foreground service 声明准确 service type 和可见通知；
- 捕获 SecurityException 并返回平台限制；
- 不利用豁免路径规避用户可见性。

来源：

- [Android：Restrictions on starting a foreground service from the background](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android：Foreground services and camera/microphone restrictions](https://developer.android.com/about/versions/11/privacy/foreground-services)

### 通知

- Android 13+ 请求 `POST_NOTIFICATIONS`；
- 在合适的产品语境申请，不在首次启动无解释弹窗；
- 当前 local-only channel 使用固定 versioned id，关闭声音、振动、灯、badge 与 DND bypass；它只发送
  immediate notification，不申请 boot 恢复或 exact alarm；
- 用户关闭 channel 后 capability profile 必须反映降级，首页提供系统设置入口，远程命令不得循环
  请求权限；channel 的 importance 创建后最终由用户控制；
- Android 前台 `shouldPlaySound: false` 不能宣称 heads-up；双端调度成功统一只写
  `presentation: system_determined`；
- iOS 只请求 alert authorization，不请求 sound、badge、critical 或 provisional；当前无 APNs
  entitlement 和 remote notification background mode；
- received callback 不等于用户已看见；只有 response listener/last response 才能形成点击观察，而当前
  local-only slice 尚未把展示/点击写入 command result。

来源：

- [Android：Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- [Android：Create and manage notification channels](https://developer.android.com/develop/ui/views/notifications/channels)
- [Apple：Asking permission to use notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)
- [Apple：Foreground notification presentation](https://developer.apple.com/documentation/usernotifications/unnotificationpresentationoptions)
- [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)

### 后台媒体

使用正规 MediaSession / foreground service 和可见媒体通知；停止播放后释放服务。

来源：[Android：Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)。

## 12. App Store / Play 合规

发布前必须：

- 权限声明与实际功能逐项对应；
- privacy policy 说明远程 Agent 调用、收集类型、保留和删除；
- 商店截图/UI 不暗示隐形监控；
- iOS Privacy Manifest 与 Android Data Safety 一致；
- 后台模式只声明实际需要的类型；
- 相机、位置、通知的 purpose string 清楚；
- 账号/配对撤销与数据删除路径可用；
- SDK 数据收集清单完成；
- 安全联系人和漏洞报告渠道存在。

## 13. 安全事件

发现凭证或远程控制风险时：

1. 服务端 capability kill switch；
2. 撤销受影响设备 key/ticket；
3. 停止签发相关命令；
4. 保留脱敏审计；
5. 发布修复版本；
6. 在 App 中提示重新配对/升级；
7. 完成根因和防复发测试。

kill switch 只会收紧能力，不能远程打开用户已关闭的权限。
