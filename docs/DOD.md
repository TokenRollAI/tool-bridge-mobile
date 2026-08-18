# Definition of Done

本文件定义“完成”的证据。口头说明、截图、模拟器 happy path 或“代码已经写完”都不能替代验收。

## 1. 当前仓库初始化 DOD

- [x] 仓库目的、边界和状态写入 README；
- [x] PRD 定义目标、非目标、MVP 和风险；
- [x] 能力目录区分 P0/P1/P2；
- [x] 架构区分当前协议与待新增能力；
- [x] SDK 文档明确当前 Node SDK 不可直接用于 React Native；
- [x] 技术选型与 ADR；
- [x] 安全、隐私与平台约束；
- [x] 上游依赖和推荐顺序；
- [x] 路线图；
- [x] CI 执行文档验证；
- [x] 独立 `pnpm-workspace.yaml`，不误加入父仓库 workspace；
- [x] MIT License；
- [ ] GitHub main 首次提交和 verify workflow 成功。

最后一项在远端创建并确认 CI 后勾选。

## 2. P0 App 骨架 DOD

### 工程

- [ ] Expo development-build 工程可 clean install；
- [ ] Node/pnpm/Expo/React Native 精确版本进入 lockfile；
- [ ] TypeScript strict 无 error；
- [ ] lint 无 warning/error；
- [ ] unit / component / protocol contract 全绿；
- [ ] Android debug build 成功；
- [ ] iOS simulator build 成功；
- [ ] 没有依赖 Expo Go 才能工作的关键路径；
- [ ] CI 从全新 checkout 可复现。

### 配置

- [ ] dev/preview/prod 有不同 application id / bundle id；
- [ ] 权限、entitlement、notification channel 与文档一致；
- [ ] 仓库无签名证书、profile、service account、APNs key 或 FCM secret；
- [ ] `.env.example` 只含非秘密字段说明；
- [ ] dependency/license/secret scan 全绿。

### 运行时

- [ ] 设备 identity 稳定且不使用硬件序列号；
- [ ] pairing ticket 单次、短期且域名可见；
- [ ] 凭证只进安全存储；
- [ ] realtime 使用短期 WebSocket ticket；
- [ ] mailbox 状态持久化；
- [ ] capability registry 来源于实际 probe；
- [ ] policy engine 在每次执行前运行；
- [ ] emergency disable 立即停止新命令；
- [ ] 撤销配对后 realtime/mailbox 都失效；
- [ ] 重启/crash 后 command 状态可恢复。

## 3. 单项能力 DOD

任何新 tool 必须同时满足以下条件。

### 产品契约

- [ ] PRD 中有用户价值和非目标；
- [ ] 能力目录有 path、tool、schema、result；
- [ ] effect、risk、confirmation、queue policy 明确；
- [ ] Android/iOS 支持矩阵明确；
- [ ] 不可用/降级语义明确；
- [ ] Agent `~help` 能发现正确能力；
- [ ] CLI 能调用和检查结果，不形成管理旁路。

### 安全与隐私

- [ ] 最小系统权限；
- [ ] 权限请求有使用语境和清晰 purpose；
- [ ] 执行前本地策略检查；
- [ ] 高风险能力有本地确认；
- [ ] 参数 runtime schema 校验，未知字段策略明确；
- [ ] 速率、时长、结果大小和 URL/MIME 等边界明确；
- [ ] 日志 redaction 测试；
- [ ] abuse cases 有测试；
- [ ] 取消、过期和撤销路径不会继续副作用。

### 正确性

- [ ] 同一 commandId 重放只执行一次；
- [ ] 断线重连不产生重复副作用；
- [ ] App crash/restart 后状态正确；
- [ ] 用户拒绝不是成功；
- [ ] OS 拒绝/降级不是成功；
- [ ] offline/queued/delivered/running/succeeded 有可观察区别；
- [ ] timeout 和 cancellation 测试；
- [ ] native error 映射为稳定 Tool Bridge code；
- [ ] 动态权限变化更新 capability；
- [ ] 对应文档和 fixture 同步。

### 验证证据

- [ ] 纯逻辑 unit test；
- [ ] UI component test；
- [ ] gateway wire contract test；
- [ ] Android emulator/instrumentation；
- [ ] iOS simulator/XCTest；
- [ ] Android 真机；
- [ ] iOS 真机；
- [ ] 支持的前台/后台/锁屏场景；
- [ ] 弱网、离线、push 未送达；
- [ ] PR 附设备/OS/build id 和脱敏日志。

平台专有能力可将另一平台标为明确 unavailable，但不能删除另一平台的协议和降级测试。

## 4. Golden Scenario DOD

### 4.1 找手机

#### 正常

- [ ] Agent 发现 `phone/attention.ring`；
- [ ] 指定设备前台在线时 2 秒内开始至少一种有效提示；
- [ ] 后台可达时命令进入 mailbox，push 后最终状态可查询；
- [ ] App 显示调用方、剩余时间和停止按钮；
- [ ] 到期自动停止；
- [ ] 用户停止后 Agent 获得 user_stopped/final 状态。

#### 异常

- [ ] 静音/DND/通知禁用时逐通道报告实际结果；
- [ ] iOS push 未送达保持 queued/expired，不假成功；
- [ ] Android 后台限制有明确状态；
- [ ] 100 次重复 commandId 只创建一个 attention session；
- [ ] rate limit 生效；
- [ ] 已撤销设备不能执行；
- [ ] 恶意超长 message 和超限 duration 被拒绝。

### 4.2 播放媒体

- [ ] 只接受 allowlisted HTTPS/objectRef；
- [ ] play/pause/resume/stop/status 一致；
- [ ] 锁屏媒体控制状态同步；
- [ ] 音频中断（来电/其他 App）正确降级；
- [ ] 后台播放有系统可见控制；
- [ ] 第三方深链只返回 handed_off；
- [ ] 重复 play 不创建重叠会话；
- [ ] 超大/错误 MIME/过期 objectRef 被拒绝。

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

- [ ] 只在权限/确认后采集；
- [ ] 返回时间与精度；
- [ ] stale location 不作为 current；
- [ ] 权限从 precise 降为 approximate 时结果反映；
- [ ] 后台不偷偷升级为持续定位；
- [ ] 审计不存精确坐标。

## 5. 平台矩阵

每个 release candidate 至少覆盖：

| 维度 | Android | iOS |
| --- | --- | --- |
| 当前最低支持版本 | 由首个 App 脚手架 ADR 锁定 | 由首个 App 脚手架 ADR 锁定 |
| 当前稳定 OS major | 必测 | 必测 |
| 上一稳定 OS major | 必测 | 必测 |
| 真机 | 至少 2 个厂商/系统组合 | 至少 2 个 OS/设备组合 |
| 前台 | 必测 | 必测 |
| 后台 | 必测 | 必测 |
| 锁屏 | 必测 | 必测 |
| 省电/低电量模式 | 必测 | 必测 |
| 通知拒绝 | 必测 | 必测 |
| 权限运行中撤销 | 必测 | 必测 |

具体最低版本只在验证 Expo SDK、商店政策和目标用户设备后决定，不能仅凭框架默认值填写。

## 6. 性能与可靠性

MVP release candidate：

- [ ] 冷启动到本地状态可见 P95 ≤ 2.5 秒（目标设备矩阵）；
- [ ] 前台在线 command 到 handler start P95 ≤ 500 ms（同区域测试网关）；
- [ ] 前台找手机请求到物理提示 P95 ≤ 2 秒；
- [ ] 已 delivered 命令终态一致率 100%；
- [ ] 连续 24 小时前后台切换无失控重连或明显电量异常；
- [ ] 10,000 条 command 去重/清理测试通过；
- [ ] 100 MB 非法上传在开始传输前被拒绝；
- [ ] command/audit 数据有界清理；
- [ ] 无主线程长任务造成明显掉帧。

性能报告必须写设备、OS、build、网络和样本数。

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
