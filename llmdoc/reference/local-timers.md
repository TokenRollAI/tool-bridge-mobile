# App 内本地 timer 参考

## 能力与输入

- `phone/productivity.timer_start` 的 strict arguments 只有 canonical UTC 毫秒 `firesAt` 和 trim 后 1–120
  字符的 `purpose`；UTC 文本必须能原样往返 `Date#toISOString()`，control/bidi 字符和未知字段被拒绝。
- `phone/productivity.timer_cancel` 与 `phone/productivity.timer_status` 只接受
  `timer_[a-f0-9]{64}`。远程 cancel/status 按 caller ownership 查询，foreign 与不存在使用同一 not-found
  边界；App 本地 UI 另有不依赖 caller 的取消入口。
- start 在 preflight、持久化 reserve 前和原生 schedule commit 前重复检查 `AbortSignal`、command
  `expiresAt` 及 firesAt 窗口。可接受窗口是从当前时钟起至少 10 秒、至多 24 小时。
- timer_start foreground only，沿用 notification 授权/channel probe，但远程命令永不请求通知权限。

## 数据与标识

- SQLite migration v2 新增 `timers` 表。稳定字段是 timer id、唯一 source command id、owner subject id、
  唯一 native notification id、firesAt、状态及创建/更新时间；`purpose` 不落库。
- 持久化状态只有 `preparing | scheduled | cancelling | cancelled | deadline_elapsed | status_unknown`。
  `schedule_missing` 是 status 查询投影，不是数据库状态。
- exclusive SQLite transaction 同时去重 source command、检查既有 timer，并原子限制活动容量：每 caller
  8 个、全局 32 个。descriptor 的 start admission（每分钟 caller 5/global 10）是另一层进程内速率限制。
- `timerId = timer_ + SHA-256(commandId)`，native id 为
  `tb_local_timer_ + SHA-256(commandId)`；相同 command 因而得到同一组标识，可安全对账和定向清理。
- 原生通知固定为 `Tool Bridge / Agent 计时器已到期`，不携带 purpose、caller 自定义 data/action、声音或
  badge。purpose 只可展示在本地 confirmation；DB、native、outcome 与普通 audit 均不得保存它。

## 调度、取消与状态

- start 先 reserve `preparing`，再用绝对 DATE trigger 调度 local notification，最后以 CAS 转为
  `scheduled`。DATE 是系统 best-effort；当前没有 boot receiver、exact alarm、FCM 或 APNs。
- native schedule 抛错、返回错误 id、revocation epoch 改变或 `preparing -> scheduled` CAS 失败时，
  controller 定向 cancel/dismiss。原始 schedule Promise 即使在本地 timeout/abort 后迟到，也由 finally
  清理，避免孤儿通知。
- cancel 用 CAS 进入 `cancelling`，随后 cancel scheduled 并 dismiss presented，成功才写 `cancelled`；若
  无法确定原生清理结果则写 `status_unknown`，不返回可盲重试的成功假象。App UI 使用同一清理路径。
- scheduled status 通过 bounded pending-id probe 投影为 `pending_observed` 或 `schedule_missing`；过期会
  清理并投影/持久化 `deadline_elapsed`。查询只说明当前可观察状态，不推断 notification history。
- emergency disable 先递增 revocation epoch，再取消全部活动 timer；已在飞行的 schedule/rearm Promise
  看到 epoch 不一致时必须清理，而不能在停用后提交。

## 启动恢复

初始化顺序是：打开 DB并迁移 -> 将中断的 running command 恢复为 `unknown_after_crash` -> reconcile
timers -> prune command 终态。不能先 prune，否则 timer 无法区分已成功调度意图与 crash orphan。

reconcile 的稳定规则：

- Disabled 模式或来源 command 不是 `succeeded`：cancel/dismiss 后终结；中断 command 形成的 orphan
  永不自动重放。
- 已过 firesAt：清理原生项并转 `deadline_elapsed`。
- 来源成功、状态 `scheduled`、仍在未来且 pending 集合缺少 native id：在重新验证授权后以同 id rearm。
- 非 scheduled 活动态、epoch/CAS 冲突或无法确定 native 结果：优先清理；无法证明清理成功时保留
  `status_unknown`。
- reconcile 完成后只保留有界数量的 terminal timer，再允许 command repository prune。

## 结果语义与证据上限

- start 成功只表示 native system 接受调度：`state: scheduled`、`scheduling: system_accepted`、
  `accuracy: system_determined`。cancel 只表示定向清理路径完成；status 是当前数据库/pending 快照。
- timer 的任何 result、UI 或审计都不得声称 fired、delivered、presented、clicked 或 on-time。
- Node/Jest 与 Android clean build 证明本地状态机、竞态补偿和原生配置可编译；API 36 smoke 只证明三项
  capability 可见。尚无实际 emulator schedule，也无 iOS build、双端真机、Doze、重启恢复、呈现或准时性
  证据。

## 事实真源

- schema/descriptor：`src/capabilities/productivity/timerSchema.ts`、`timerCapabilities.ts`
- 状态机：`src/capabilities/productivity/timerController.ts`
- native adapter：`src/capabilities/productivity/notificationAdapter.ts`
- migration/repository：`src/storage/migrations/0002_timers.ts`、`src/storage/timerRepository.ts`
- 初始化/停用/UI 装配：`src/runtime/applicationRuntime.ts`
- 产品与验收：`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/DOD.md`、`docs/UPSTREAM.md`
