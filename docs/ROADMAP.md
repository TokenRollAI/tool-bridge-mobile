# 路线图

路线图按可验收的纵向切片组织，不按“先把所有页面画完”组织。阶段日期在团队排期后确定。

## P0：仓库与协议地基

目标：任何能力实现前，先建立可安全演进的移动运行时骨架。

### 工作项

- [x] 建立独立仓库、产品与架构文档；
- [x] 初始化 Expo TypeScript development-build 工程；
- [x] 配置 Android applicationId、iOS bundle id 和三环境；
- [x] 建立严格 TypeScript、lint、test、CI；
- [x] 建立 app/service/storage/native module 目录；
- [x] 接入上游公共 `@tool-bridge/sdk/device@0.11.0`；
- [x] 本机 Gateway HTTPS URL + API key 内测入口（非 pairing）；
- [ ] pairing UI + SecureStore；
- [x] SQLite command/audit schema 和 migration；
- [ ] 前台 WebSocket ticket 连接；
- [x] capability registry 与 policy engine；
- [x] 权限/能力页、活动页、紧急停用；
- [ ] fake gateway 和协议 fixture；
- [x] Android debug / preview 与 iOS simulator clean build；

### 当前证据与未实现边界

- `pnpm verify` 已覆盖 strict TypeScript、零 warning lint、unit/component/local contract、配置与
  供应链检查；commit `a4edb73` 的 Actions run 32239849273 已从 clean checkout 完成 frozen install、
  全量 verify、Android preview APK 与 iOS simulator build。Android 另有本地 clean debug 证据；这些
  关闭工程 CI/build 项，但不替代双端真机、正式签名或商店 release；
- 本地 slice 已有 `phone/status.get`、SecureStore `installationId`、SQLite 持久化、能力/活动页与
  emergency disable，并新增 SecureStore credential facade、fail-closed 本地撤销和有界清理；组合
  工作项仍含权限页、pairing 或网关协议时不因部分实现提前勾选；
- 本地 executor 已增加 confirmation 前 admission、结果字节上限、claim 后取消/到期复检、deadline
  传播和进行中命令全局取消；HTTPS 媒体已增加最终 URL、MIME/签名、声明/实际字节与清理边界，
  production revoke 仍未接入真实 transport；
- command 终态写入与 retention prune 已进入同一 SQLite transaction，长驻进程也持续保持 10,000 条
  终态硬上限；running、当前完成项与活动 timer source 不会被该事务误删；
- API 36 Android emulator smoke 已覆盖干净安装、最小权限、动态能力页、紧急停用与进程重启持久化；
  这不是 Android/iOS 真机行为证据；
- U-1 已由 `@tool-bridge/sdk/device@0.11.0` 交付并接入：官方 supervisor、RN Authorization header、
  AppState suspend/resume、registry expose 与 SDK call adapter 已有 contract 和双端 Metro 证据；只有
  `ready` 才显示 online；
- 首页已提供手工 URL + API key fallback，secret 只进入 SecureStore，保存/清除前先停止旧 transport；
  它使用客户端派生 deviceId，不满足 pairing、最小权限 credential、rotation/revoke 或短期 ticket；
- U-2 至 U-6 仍未交付。短期 ticket、真实 gateway fixture、具体 caller/deadline attribution、mailbox 与
  push 均未完成。

### 出口

Android/iOS 真机可配对、显示设备状态、前台注册 `phone/status.get`，撤销后立即失效；没有
硬编码 SK，没有复制上游协议源码。

## P1-A：找手机 golden slice

目标：第一个真正让 Agent 的手触达物理设备的闭环。

### 工作项

- [x] `phone/attention.ring/stop` schema 与 capability；
- [ ] Android sound/vibration/flash adapter；
- [ ] iOS sound/haptic/notification adapter；
- [x] 双端共享的固定本地 WAV sound adapter（不绕过静音/DND）；
- [x] Android vibration / iOS haptic adapter；
- [ ] flash adapter（当前不声明 Camera 权限）；
- [x] 本地停止 UI；
- [x] session TTL、限流、幂等；
- [ ] DND/静音/权限降级结果；
- [ ] mailbox + APNs/FCM push；
- [ ] queued/delivered/running/final 状态；
- [ ] 锁屏、后台、杀进程、弱网真机测试；
- [ ] Agent/CLI golden scenario。

### 出口

前台和后台可达场景都能得到真实状态；系统不允许的通道明确降级；重复 commandId 不产生第二次
响铃；用户随时可停止。

## P1-B：媒体与内容交接

目标：让 Agent 把内容可靠送到手机。

### 工作项

- [x] App 自有播放器；
- [x] media session / lock screen controls；
- [x] `play/pause/resume/stop/status`；
- [ ] HTTPS/objectRef source policy；
- [x] `open_url/can_open_url` allowlist；
- [x] `open_map`；
- [ ] 通知 deep link；
- [ ] 后台播放、耳机控制、音频中断测试。

当前本地实现使用精确锁定的 `expo-audio`：只接受配置 allowlist 内的标准端口 HTTPS，经手动 redirect、
最终 URL、MIME/签名、声明/实际 25 MiB 校验后流式写入 App 私有 cache，player 不接收远程 URL；
player 在 `play()` 前拒绝直播、无效时长和超过 2 小时的媒体；单会话阻止重叠播放，并配置 Android
可见 media foreground service 与 iOS `audio` background mode。
完整 URL 不进入 session projection 或普通审计。`objectRef` 和双端真机锁屏/后台行为仍未完成；
“media session / lock screen controls”勾选只代表代码与原生配置存在，不替代真机 DOD。

`phone/apps.open_url/can_open_url` 当前只接受 `EXPO_PUBLIC_LINK_HOSTS` 中的精确 HTTPS hostname；
HTTP、凭证、非 443 端口、fragment、IP literal 与未授权 hostname 在确认提示前被拒绝。`open_url`
经单次本地确认和系统 `canOpenURL` 后只返回 `handed_off`，不声称浏览器/第三方 App 内动作完成。

`phone/location.open_map` 只接受 strict 结构化坐标/查询，provider URL/scheme 由本地按平台构造；它不
读取当前位置或申请权限。固定逐次确认，结果和普通审计不回显目标；Android `geo` handler query 已由
config introspection 验证。双端真机实际地图 handoff 仍未验收。

### 出口

Agent 能播放一段允许的媒体并控制本 App 会话；第三方 App 只返回 handed_off，不假成功。

## P1-C：相机协作

目标：把手机变成用户掌控的 Agent 视觉输入。

### 工作项

- [ ] object upload 上游能力；
- [ ] 相机权限教育与请求；
- [ ] 可见预览、purpose 和本地确认；
- [ ] 拍照、压缩、EXIF 策略；
- [ ] sha256 和单次上传；
- [ ] objectRef result；
- [ ] 取消、过期、上传失败和 crash cleanup；
- [ ] 前后台/锁屏/权限撤销真机测试。

### 出口

远程请求绝不会在后台静默拍照；用户确认后 Agent 获得有限期 objectRef；媒体不进入协议日志。

## P1-D：位置与本地辅助

目标：完成 MVP 能力集合。

### 工作项

- [x] `location.current`；
- [x] `productivity.notify`；
- [x] App 内 timer；
- [ ] 动态 capability change 上报；
- [x] 完整活动/审计页（FR-10 近期本地元数据 + 仅审计历史清除）；
- [x] accessibility semantics 自动化基线（common RN component + Android semantic/200% font smoke）；
- [ ] TalkBack / VoiceOver / Switch Access / iOS Dynamic Type 平台验收；
- [ ] 国际化资源、locale/date/number 格式与 fallback；
- [ ] 隐私/商店文案与 legal review；
- [ ] 商店合规材料；
- [ ] beta 测试与 staged rollout。

当前本地 `phone/location.current` 仅在 App 前台可用，high risk 且每次确认；确认前不会请求系统权限
或采集位置。它只申请 foreground/when-in-use 权限，以一次性、可取消订阅取得首个 fix，拒绝超过
30 秒或未来偏移超过 5 秒的结果，并返回采集时间、水平精度和 precise/approximate 状态。普通审计
不保存坐标。`open_map` 已形成独立结构化 handoff 切片；后台/持续定位、上游发现与双端真机证据不在
`location.current` 勾选范围内。

`phone/productivity.notify` 当前是前台、即时、local-only 的安全切片：strict schema 只接受 purpose/message，
OS 标题与来源前缀固定，远程调用不能请求系统权限或附带 URL/data/action/sound/badge；Android 使用固定
channel，iOS 不声明 APNs entitlement 或 remote-notification background mode。原生 API 返回后只报告
`scheduled/system_determined`，不声称通知已展示或用户已点击。双端真机授权、前后台呈现与点击观察，
以及 U-5/U-6 mailbox/push 仍未完成；这些边界不因本项本地实现被勾选而改变。

App 内 timer 已实现为 `timer_start/timer_cancel/timer_status`：SQLite v2 保存非敏感状态并原子限制活动
容量，Expo 绝对 DATE trigger 只作为 best-effort 提示；purpose 只进入本地确认。crash orphan、迟到
native promise、caller 隔离、前台 reconciliation、设备本地取消和 emergency disable 均有自动化契约。
该勾选不表示系统准时展示：Android/iOS 真机、Doze/低电量、进程 kill、Android reboot、权限/channel
运行中撤销与到点取消竞态仍需 DOD 证据；构建继续不声明 boot/exact/FCM/APNs。

accessibility semantics 基线已覆盖页面/卡片标题、关联后的状态行、唯一且有上下文的操作名称、
disabled/busy 状态、48dp 最小触控区、离散状态公告去重、焦点往返，以及文本/交互边界对比度 gate。
API 36 emulator 在 200% 系统字号下走过四个标签页与活动历史确认操作。该勾选只代表 common RN
自动化与 Android 语义树 smoke；TalkBack/VoiceOver 实际朗读、手势顺序、Switch Access、iOS Dynamic
Type 和双端真机人工验收仍是独立未完成项。

活动页已展示最近 100 条调用的 caller subject id、path/tool、effect/risk、decision、outcome code 与时间；
SQLite 在每次写入事务内把本机审计硬限制为 5,000 条。用户清除前必须确认不可恢复范围，且清除只作用
于 `audit_records`：同一 `commandId` 的持久化防重放、timer、设置、installation identity 与凭证都不受
影响。该勾选不表示网关撤销、服务端审计或 Release DOD 的完整数据删除已完成。

## P2：更长的手，但不降低安全

候选：

- QR/条码本地扫描；
- 用户确认的短视频和实时 WebRTC；
- 地理围栏；
- 系统 compose message / dial handoff；
- 传感器短时采样；
- 可签名的组织 policy profile；
- 多网关/多 Agent 的细粒度授权；
- 设备事件订阅；
- Wear OS / watchOS 配套入口。

每项能力进入实现前都要新增：

- 产品用例；
- 平台矩阵；
- 权限与商店评审；
- abuse case；
- 独立 DOD。

## P3：设备网络

长期方向：

- 手机作为附近设备发现和人机确认枢纽；
- Agent 在浏览器、手机、桌面间选择最合适执行端；
- 设备间安全 handoff；
- 实时空间/视觉协作；
- 组织设备 fleet profile。

这不是把所有设备变成 root shell，而是建立可发现、最小授权、平台诚实的现实世界工具网络。

## 优先级规则

出现需求冲突时按以下顺序：

1. 用户安全与平台政策；
2. 身份、权限、幂等和审计；
3. 端到端场景可完成；
4. 双端语义一致；
5. 能力数量；
6. UI 装饰和 Dashboard。

一个安全、可解释的 `ring` 闭环，优先于十个只在演示环境“看起来能调”的硬件 API。
