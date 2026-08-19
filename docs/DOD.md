# Definition of Done

本文件定义“完成”的证据。口头说明、截图、模拟器 happy path 或“代码已经写完”都不能替代验收。

## 1. 当前仓库初始化 DOD

- [x] 仓库目的、边界和状态写入 README；
- [x] PRD 定义目标、非目标、MVP 和风险；
- [x] 能力目录区分 P0/P1/P2；
- [x] 架构区分当前协议与待新增能力；
- [x] SDK 文档明确根入口与 React Native `/device` 子入口边界；
- [x] 技术选型与 ADR；
- [x] 安全、隐私与平台约束；
- [x] 上游依赖和推荐顺序；
- [x] 路线图；
- [x] CI 执行文档验证；
- [x] 独立 `pnpm-workspace.yaml`，不误加入父仓库 workspace；
- [x] MIT License；
- [x] GitHub main 首次提交和 verify workflow 成功。

## 2. P0 App 骨架 DOD

### 工程

- [x] Expo development-build 工程可 clean install；
- [x] Node/pnpm/Expo/React Native 精确版本分别由 `.node-version`、`packageManager`、
  `package.json` 与 lockfile 锁定；
- [x] TypeScript strict 无 error；
- [x] lint 无 warning/error；
- [ ] unit / component / protocol contract 全绿；
- [x] Android debug build 成功；
- [ ] iOS simulator build 成功；
- [x] 没有依赖 Expo Go 才能工作的关键路径；
- [ ] CI 从全新 checkout 可复现。

当前测试事实：unit、component、本地运行时与 SDK device consumer contract 共 221 项全绿；真实
gateway wire fixture 尚未
交付，所以组合项中的 protocol contract 不提前勾选。Android 已用仓库正式 clean build 入口在本地
构建成功，证据见 [2026-08-19 Android debug 验证记录](verification/2026-08-19-android-debug.md)；iOS
与 clean-checkout CI 在成功记录产生前继续保持未完成。另有内嵌 JS、debug test key 签名且可安装的
[Android preview APK 本地验证](verification/2026-08-19-android-preview-apk.md)，但它不替代 CI artifact、
生产签名、真机或 release DOD。

### 配置

- [x] dev/preview/prod 有不同 application id / bundle id；
- [x] 权限、entitlement、notification channel 与文档一致；
- [x] 仓库无签名证书、profile、service account、APNs key 或 FCM secret；
- [x] `.env.example` 只含非秘密字段说明；
- [x] dependency/license/secret scan 全绿。

这里的 dependency 勾选表示仓库定义的 high-severity policy gate 通过，不表示零 advisory：当前
`pnpm audit:dependencies` 报告 1 个 moderate，并显示 2 个 `image-size` high 已按
`pnpm-workspace.yaml` 定向豁免；后两项有仓库补丁和恶意 ICNS/JXL 回归测试。release 阶段的 SBOM /
dependency audit 仍保持未完成。

### 运行时

- [x] 设备 identity 稳定且不使用硬件序列号；
- [x] 手工 Gateway URL + API key 内测入口只接受 HTTPS origin，secret 只进 SecureStore，保存/清除前
  停止旧 transport，失败时不自动重连；
- [ ] pairing ticket 单次、短期且域名可见；
- [x] 凭证只进安全存储；
- [x] 前台 realtime 使用上游正式 React Native device client；
- [ ] realtime 使用短期 WebSocket ticket；
- [ ] mailbox 状态持久化；
- [x] capability registry 来源于实际 probe；
- [x] policy engine 在每次执行前运行；
- [x] emergency disable 立即停止新命令；
- [ ] 撤销配对后 realtime/mailbox 都失效；
- [x] 重启/crash 后 command 状态可恢复。

这里的 identity 是 SecureStore 中的本地 `installationId`；手工内测模式派生的 `mobile_<uuid>` 只是
客户端声明的 SDK deviceId，不是网关签发身份。credential 勾选项代表 opaque credential facade 与手工
API key 只使用 SecureStore，当前仍无 pairing 签发凭证。前台 realtime
勾选项证明 `@tool-bridge/sdk/device@0.11.0` 的 RN header、hello/ready/call/result、cancel 与 AppState
suspend/resume 已接到本地 executor，并通过 fake WebSocket contract 和双端 Metro；它不证明真实 gateway、
短期 ticket、pairing、后台 mailbox 或撤销端到端。U-1 已解阻，U-2 至 U-6 仍未完成。证据见
[SDK device integration 验证](verification/2026-08-19-sdk-device-integration.md)。
手工 Gateway 配置的输入、SecureStore 与 transport 切换证据见
[2026-08-19 手工 Gateway 配置验证](verification/2026-08-19-manual-gateway-configuration.md)；它不替代
pairing、短期 ticket 或真实网关联合验收。

## 3. 单项能力 DOD

任何新 tool 必须同时满足以下条件。

### 产品契约

- [x] PRD 中有用户价值和非目标；
- [x] 能力目录有 path、tool、schema、result；
- [x] effect、risk、confirmation、queue policy 明确；
- [x] Android/iOS 支持矩阵明确；
- [x] 不可用/降级语义明确；
- [ ] Agent `~help` 能发现正确能力；
- [ ] CLI 能调用和检查结果，不形成管理旁路。

### 安全与隐私

- [x] 最小系统权限；
- [x] 权限请求有使用语境和清晰 purpose；
- [x] 执行前本地策略检查；
- [x] 高风险能力有本地确认；
- [x] 参数 runtime schema 校验，未知字段策略明确；
- [x] 速率、时长、结果大小和 URL/MIME 等边界明确；
- [x] 日志 redaction 测试；
- [x] abuse cases 有测试；
- [ ] 取消、过期和撤销路径不会继续副作用。

当前本地 registry 的每个 capability 已声明 caller/global 滑动窗口和 inline 结果字节上限；executor
在 confirmation 前 admission，超大 JSON 结果不会写入 command store。claim 完成后还会最后复检
取消/到期，command deadline 会截断 attention TTL 与 location 等待，emergency disable 会取消进行中
handler。HTTPS 媒体在 player 创建前逐跳校验 redirect 与最终 URL，以 allowlist MIME + 文件签名校验
内容，并同时限制声明/实际字节为 25 MiB；原生 port 在 `play()` 前拒绝直播、无效或超过 2 小时的
时长。第一项只证明当前本地 registry 的明确边界；进程内
admission 重启后会重置，且 production revoke 尚未接到真实 realtime/mailbox，因此取消/撤销组合项
仍保持未完成。

### 正确性

- [x] 同一 commandId 重放只执行一次；
- [ ] 断线重连不产生重复副作用；
- [x] App crash/restart 后状态正确；
- [x] 用户拒绝不是成功；
- [x] OS 拒绝/降级不是成功；
- [ ] offline/queued/delivered/running/succeeded 有可观察区别；
- [x] timeout 和 cancellation 测试；
- [x] native error 映射为稳定 Tool Bridge code；
- [x] 动态权限变化更新 capability；
- [ ] 对应文档和 fixture 同步。

### 验证证据

- [x] 纯逻辑 unit test；
- [x] UI component test；
- [ ] gateway wire contract test；
- [x] Android emulator/instrumentation；
- [ ] iOS simulator/XCTest；
- [ ] Android 真机；
- [ ] iOS 真机；
- [ ] 支持的前台/后台/锁屏场景；
- [ ] 弱网、离线、push 未送达；
- [ ] PR 附设备/OS/build id 和脱敏日志。

平台专有能力可将另一平台标为明确 unavailable，但不能删除另一平台的协议和降级测试。

Android 项当前由 API 36 arm64 emulator 上可重复执行的 UI smoke 覆盖，验证干净安装、development
build 启动、安装后权限清单、动态能力页、紧急停用和进程重启持久化，以及活动历史范围确认/空历史
清除结果、四个 tab 语义/selected state 和 200% 系统字号关键交互；它不是 Android 原生
instrumentation，也不替代 TalkBack/VoiceOver、真机 haptic、音频、位置、后台或锁屏验收。证据见
[2026-08-19 Android emulator smoke](verification/2026-08-19-android-emulator.md)。

## 4. Golden Scenario DOD

### 4.1 找手机

#### 正常

- [ ] Agent 发现 `phone/attention.ring`；
- [ ] 指定设备前台在线时 2 秒内开始至少一种有效提示；
- [ ] 后台可达时命令进入 mailbox，push 后最终状态可查询；
- [x] App 显示调用方、剩余时间和停止按钮；
- [x] 到期自动停止；
- [ ] 用户停止后 Agent 获得 user_stopped/final 状态。

#### 异常

- [ ] 静音/DND/通知禁用时逐通道报告实际结果；
- [ ] iOS push 未送达保持 queued/expired，不假成功；
- [ ] Android 后台限制有明确状态；
- [x] 100 次重复 commandId 只创建一个 attention session；
- [x] rate limit 生效；
- [ ] 已撤销设备不能执行；
- [x] 恶意超长 message 和超限 duration 被拒绝。

### 4.2 播放媒体

- [ ] 只接受 allowlisted HTTPS/objectRef；
- [x] play/pause/resume/stop/status 一致；
- [ ] 锁屏媒体控制状态同步；
- [ ] 音频中断（来电/其他 App）正确降级；
- [ ] 后台播放有系统可见控制；
- [x] 第三方深链只返回 handed_off；
- [x] 重复 play 不创建重叠会话；
- [ ] 超大/错误 MIME/过期 objectRef 被拒绝。

当前媒体勾选项只代表本地 `phone/media` strict schema、单 player 会话、控制器/组件/本地 contract
自动化证据。HTTPS 来源已有 hostname allowlist、手动 redirect、最终 URL、MIME/文件签名、声明/实际
25 MiB 上限、取消/超时及临时文件清理测试；player 只接收 App 私有 `file://` 缓存，并在播放前执行
10 秒 metadata timeout 与 2 小时时长上限。两个组合项还要求
`objectRef` 及其过期语义，因此保持未完成；当前 strict schema 会拒绝 `objectRef`。锁屏控制、后台
播放、音频中断和物理输出必须在双端真机留下证据后才能勾选。

### 4.3 相机协作

- [ ] 后台命令只进入 awaiting_user；
- [ ] 用户看到 caller、purpose 和目标网关；
- [ ] 用户进入前台并明确确认；
- [ ] 相机预览和系统指示可见；
- [ ] 拍摄后默认移除 EXIF 位置；
- [ ] 上传使用绑定 commandId 的单次 URL；
- [ ] result 只有 objectRef 和元数据；
- [ ] 对象到期不可读取；
- [ ] 拒绝、权限撤销、锁屏、离线、上传失败均无假成功；
- [ ] 日志/崩溃产物无图像字节、signed URL 和精确位置；
- [ ] crash 后孤儿文件清理。

### 4.4 位置

- [x] 只在权限/确认后采集；
- [x] 返回时间与精度；
- [x] stale location 不作为 current；
- [x] 权限从 precise 降为 approximate 时结果反映；
- [x] 后台不偷偷升级为持续定位；
- [x] 审计不存精确坐标。
- [x] 地图只接受结构化目标，结果/审计不回显目标且只报告 handed_off。

这些勾选项由 strict schema、注入式 controller/本地运行时 contract、动态 foreground permission probe、
一次性 `watchPositionAsync` 取消路径和原生配置 introspection 支撑。它们证明采集边界与结果语义，
不等同于 Android/iOS 真机权限、精度或系统服务行为已验收。`open_map` 另有 platform builder 注入、
5 秒 probe/deadline、确认、幂等和脱敏结果 contract；只证明提交边界，不证明 Android/iOS 真机地图 App
实际打开。双端真机项仍保持未完成。

### 4.5 即时本地通知

- [x] 唯一路径是 `phone/productivity.notify`，strict schema 只接受有界 purpose/message；
- [x] title、URL、data、action、sound、badge、schedule 与控制/bidi 字符被拒绝；
- [x] 远程命令不会请求系统权限，未授权、后台或 Android channel 关闭时 zero schedule；
- [x] OS 标题/来源前缀和无声 channel 固定，caller/subject/purpose 不进入原生通知 payload；
- [x] Ask every time 确认、trusted session、确认前 caller/global admission 均有 contract 证据；
- [x] 100 个重复 commandId、跨 executor replay 和 crash recovery 不产生第二次通知；
- [x] message/purpose 不进入持久化 command outcome 或普通 audit；
- [x] 成功只返回 `scheduled/system_determined`，不声称 delivered、presented 或 clicked；
- [x] Android 配置有 `POST_NOTIFICATIONS`，无 boot/exact alarm、C2DM/厂商 badge 权限或 FCM
  service/receiver/provider；iOS 无 APNs entitlement 或 remote-notification background mode；
- [ ] Android 13+ 真机覆盖 fresh grant/deny、channel off、前台/后台呈现与冷/热启动点击；
- [ ] iOS 真机覆盖 grant/deny、前台/锁屏呈现与冷/热启动点击。

已勾选项来自 schema/adapter/controller/component/local runtime contract 与 Expo config introspection。
原生 `scheduleNotificationAsync` promise 返回只证明系统接受调度请求；模拟器、received listener 或
代码存在都不能升级为用户已看见/点击的证据。当前不注册 push token、不接 mailbox，因而也不满足
U-5/U-6 或 DOD 的 push/background 组合项。

### 4.6 App 内计时器

- [x] `timer_start` strict schema 只接受 canonical UTC firesAt 与有界安全 purpose；
- [x] caller 提供的 duration/timezone、label/message/title、repeat、URL/data/action/sound/badge/channel
  和 unknown field 均被拒绝；
- [x] handler commit 时再次执行 10 秒至 24 小时窗口检查，未授权、后台、确认拒绝、取消或过期均
  zero native schedule；
- [x] purpose 只进入本地确认，不进入 SQLite、固定 native payload、command outcome 或普通 audit；
- [x] SQLite v2 顺序 migration、状态 CHECK/UNIQUE/index、每 caller 8/全设备 32 原子 reserve 与终态
  retention 有测试；
- [x] start/status/cancel 结果区分 system accepted、pending observed、missing、deadline elapsed、cancelled
  与 unknown，且不声称 fired/delivered/presented/clicked/on-time；
- [x] 同 caller ownership、异主/不存在统一 not_found、设备本地取消入口与 Disabled stopAll 有证据；
- [x] 100 个重复 commandId、跨 executor replay 只产生一行/一次 schedule；crash orphan 不重放；
- [x] schedule timeout/迟到 resolve、CAS 失败、cancel 与 emergency epoch 走确定性 ID 补偿；无法证明清理
  时返回 non-retryable unknown；
- [x] App 启动/回到前台在 command recovery 后、prune 前 reconciliation；successful future missing 才可
  同 ID re-arm，deadline elapsed 不推断 delivery；
- [x] 继续无 boot/exact alarm、FCM/C2DM/Firebase remote transport、APNs entitlement 或
  remote-notification background mode；
- [ ] Android 真机覆盖前台/后台/锁屏、进程 kill、reboot、Doze/低电量、权限/channel 运行中撤销与到点
  cancel race；
- [ ] iOS 真机覆盖前台/后台/锁屏、进程 kill、低电量、权限运行中撤销与到点 cancel race。

已勾选项由 migration/schema/repository/adapter/controller/component/local runtime contract 与既有 final
config verifier 支撑。绝对 DATE trigger 只是系统 best-effort 调度：没有 exact alarm 或 boot receiver，
测试中的 pending set 也不是系统呈现证据。真机项完成前不得把 timer 写成准点闹钟或已送达提醒。

### 4.7 本地活动历史

- [x] 页面展示 occurredAt、caller subject id、path/tool、effect/risk、decision 与 outcome code；
- [x] 页面不展示 command arguments、完整 outcome、commandId、坐标、URL、message/purpose 或凭证；
- [x] 页面明确只展示最近 100 条，SQLite 每次 insert 都在同一事务内维持 5,000 条硬上限；
- [x] 清除前有设备本地 destructive confirmation，明确不可恢复和实际数据范围；
- [x] 清除只执行 `DELETE FROM audit_records`，不改变 command、timer、设置、installation identity 或
  credential；Disabled/通知权限也不阻止本地入口；
- [x] 清除成功显示真实删除数，失败不假装成功；DELETE 之后完成的新审计允许继续保留；
- [x] 清除后重放同一有副作用 commandId，handler 仍只执行一次且新审计标为 replayed；
- [x] repository、retention、component 与 local contract 有自动化证据，Android emulator 覆盖范围文案、
  取消确认和真实空历史清除。

本节只验收 FR-10 的近期本机元数据和“仅审计历史清除”。它不删除 command outcome、timer、设置、
SecureStore 或服务端数据，也不撤销配对/transport，因而不能用于勾选 Release DOD 的“数据删除和撤销
流程”。服务端安全审计与本机用户可清历史必须继续分开定义。

### 4.8 Accessibility semantics 自动化基线

- [x] 四个标签页各有唯一页面 header，所有状态卡片 title 是 header；
- [x] label/value 状态行合并为单一可访问名称，视觉文本不会被重复朗读，并支持换行与系统字号；
- [x] timer、pending confirmation 等重复操作使用不含敏感正文的唯一上下文名称；
- [x] 所有共享操作声明 button role、必要 hint、disabled/busy 状态与至少 48dp 的最小触控区；
- [x] 仅在标签页获得焦点时聚焦页面标题，普通 snapshot 更新不抢焦点；活动历史 destructive
  confirmation 打开后聚焦标题，取消后返回触发按钮；
- [x] 只公告错误、控制模式、pending 数量、timer/media 等离散变化；初始 render、相同 semantic key、
  attention 倒计时、媒体进度和敏感 confirmation detail 不进入公告；
- [x] 自动化对比度 gate 要求普通文本至少 4.5:1、大文本和交互边界至少 3:1；卡片/secondary action
  使用独立高对比 `outline`，不依赖低对比装饰 border 表达状态；
- [x] component test 覆盖 header/关联/唯一名称/state/focus/announcement/target size，API 36 emulator
  覆盖四个 tab 的唯一 label/selected state 与 200% 系统字号下的关键交互；
- [ ] Android 真机 TalkBack 实际朗读、手势顺序与 Switch Access 人工验收；
- [ ] iOS 真机 VoiceOver、阅读顺序与 200% Dynamic Type 人工验收。

本节勾选的是 common React Native 语义契约、component test 和 Android emulator 语义树/大字号 smoke。
自动化无法证明读屏器实际发音、rotor/手势导航、平台焦点顺序、Switch Access 或 iOS Dynamic Type；
这些平台项在真实设备证据产生前继续保持未完成，也不能由 Android common-code 结果代替 iOS 验收。

## 5. 平台矩阵

每个 release candidate 至少覆盖：

| 维度 | Android | iOS |
| --- | --- | --- |
| 当前最低支持版本 | Android 7.0 / API 24 | iOS 16.4 |
| 当前稳定 OS major | 必测 | 必测 |
| 上一稳定 OS major | 必测 | 必测 |
| 真机 | 至少 2 个厂商/系统组合 | 至少 2 个 OS/设备组合 |
| 前台 | 必测 | 必测 |
| 后台 | 必测 | 必测 |
| 锁屏 | 必测 | 必测 |
| 省电/低电量模式 | 必测 | 必测 |
| 通知拒绝 | 必测 | 必测 |
| 权限运行中撤销 | 必测 | 必测 |

工程最低版本已由 [ADR-0002](adr/0002-app-scaffold-baseline.md) 锁定；这只是 App 可安装/构建边界，
具体能力仍需按目标设备、商店政策和实际 probe 验证，不能仅凭 OS 名称声称可用。

## 6. 性能与可靠性

MVP release candidate：

- [ ] 冷启动到本地状态可见 P95 ≤ 2.5 秒（目标设备矩阵）；
- [ ] 前台在线 command 到 handler start P95 ≤ 500 ms（同区域测试网关）；
- [ ] 前台找手机请求到物理提示 P95 ≤ 2 秒；
- [ ] 已 delivered 命令终态一致率 100%；
- [ ] 连续 24 小时前后台切换无失控重连或明显电量异常；
- [x] 10,000 条 command 去重/清理测试通过；
- [ ] 100 MB 非法上传在开始传输前被拒绝；
- [x] command/audit 数据有界清理；
- [ ] 无主线程长任务造成明显掉帧。

性能报告必须写设备、OS、build、网络和样本数。

command 有界清理不再只依赖启动：每次终态 UPDATE 与 prune 在同一 SQLite exclusive transaction 内
维持 10,000 条总上限，并保护 running、刚完成项与活动 timer source；审计则在每次 insert transaction
内维持 5,000 条。内存仓储、生产 SQL 形状和真实 SQLite 语法/计数场景均有验证，见
[command retention 验证](verification/2026-08-19-command-retention.md)。

## 7. PR DOD

合并前：

- [ ] scope 单一且可回滚；
- [ ] PR 描述解释“为什么”；
- [ ] 列出能力、权限、协议和数据处理变化；
- [ ] 自动验证全绿；
- [ ] 按变更类型完成原生 build/真机验证；
- [ ] 安全敏感 diff 有第二位 reviewer；
- [ ] 上游/下游兼容已验证；
- [ ] README/PRD/CAPABILITIES/SDK/DOD 按需同步；
- [ ] 没有未解释的 generated native diff；
- [ ] 没有秘密或敏感日志；
- [ ] release note 标出用户可感知变化。

## 8. Release DOD

### 构建与供应链

- [ ] clean release build；
- [ ] lockfile frozen；
- [ ] artifact 可追溯到 commit；
- [ ] 签名密钥来自受控 secret store；
- [ ] SBOM / dependency audit；
- [ ] release artifact 安装 smoke；
- [ ] gateway compatibility matrix 通过。

### 安全与合规

- [ ] privacy policy；
- [ ] iOS privacy manifest / usage descriptions；
- [ ] Google Play Data Safety / permissions；
- [ ] push entitlement/environment；
- [ ] 数据删除和撤销流程；
- [ ] capability kill switch；
- [ ] incident contact；
- [ ] 商店元数据不夸大后台或系统能力。

### Rollout

- [ ] internal/beta 环境 golden scenarios；
- [ ] staged rollout；
- [ ] crash、ANR、command failure、push invalid token 监控；
- [ ] rollback 版本和服务端兼容保留；
- [ ] release 后复核远程禁用和凭证撤销；
- [ ] 文档状态从“规划”改为对应 beta/stable。

## 9. 变更类型与最低验证

| 变更 | 最低验证 |
| --- | --- |
| 仅文档 | `pnpm verify` |
| 纯 TS 逻辑 | typecheck + lint + unit + contract |
| React UI | 上述 + component + 双端截图/交互 |
| Expo config/依赖 | 上述 + Android/iOS clean build |
| Kotlin | 上述 + Android native test + 真机相关场景 |
| Swift | 上述 + iOS native test + 真机相关场景 |
| push/background | 双端真机前后台/杀进程/过期 |
| 权限/相机/位置/音频 | 双端真机 + 权限拒绝/撤销 |
| 协议/schema | 上游/downstream contract + 兼容版本 |
| credential/storage | 安全 review + migration/crash recovery |

## 10. “没有完成”的典型情况

- 前台 demo 成功，但后台命令没有 mailbox；
- API 返回 200，但设备没有执行或用户拒绝；
- Android 可用，iOS 用同样结果假装可用；
- 重连重复响铃/通知；
- 相机把 base64 放 result；
- SDK 示例依赖未发布包却未标提案；
- Expo Go 能跑，但 development/release build 未验证；
- 只有 Dashboard 可配置，CLI/API 不对等；
- 权限说明写在文档，代码却在首次启动全部申请；
- 测试因外部服务失败被跳过但宣称全绿。
