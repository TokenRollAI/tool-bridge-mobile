# 本地命令运行时架构

## 目的

本地安全执行边界独立于 transport：最初可由 fake dispatcher 驱动，现在也由
`@tool-bridge/sdk/device@0.11.0` 前台 call adapter 驱动；重复投递、用户等待、崩溃和日志处理都不能因
transport 变化产生隐蔽副作用或泄漏敏感参数。

## 核心组件

- `src/runtime/applicationRuntime.ts` (`ApplicationRuntime`)：组装 registry、SQLite、策略、确认、SDK
  transport 与 UI snapshot；AppState 变化时重新 probe 并 suspend/resume realtime。
- `src/gateway/sdkDeviceTransport.ts`：只用上游公开 `/device` 入口，把 SDK call 归一为本地 command；
  负责 credential audience、RN header、AppState lifecycle 和 ready-only online。
- `src/gateway/manualGatewayConfigurationController.ts`：协调首页手工 Gateway URL/API key 的配置切换；
  保存和清除都先停止旧 transport，SecureStore 失败时保持断开。
- `src/runtime/localCommandExecutor.ts` (`LocalCommandExecutor`)：唯一的本地 command 执行入口和安全顺序。
- `src/capabilities/registry.ts` (`CapabilityRegistry`)：解析 path/tool、strict arguments、probe 和 handler。
- `src/policy/policyEngine.ts` (`PolicyEngine`)：根据 control mode、risk、confirmation 与前后台裁决。
- `src/policy/localConfirmationCoordinator.ts` (`LocalConfirmationCoordinator`)：最多 10 个内存 pending，
  只投影 UI 必需元数据和 capability 显式挑选的详情。
- `src/storage/commandRepository.ts` (`SqliteCommandRepository`)：以 `commandId` 原子 claim、保存终态并
  去重；每次 complete 在同一 exclusive transaction 内把终态总数维持在 10,000。
- `src/storage/auditRepository.ts` (`SqliteAuditRepository`)：只保存脱敏调用元数据；每次写入同一 SQLite
  exclusive transaction 内裁剪至 5,000 条，并提供只删除 `audit_records` 的 clear。
- `src/storage/timerRepository.ts` (`SqliteTimerRepository`)：在 SQLite schema v2 中原子 reserve caller/global
  容量、执行状态 CAS，并按 command 终态提供启动恢复视图。

## 执行顺序

```text
envelope schema
  -> existing/in-flight commandId 去重
  -> capability resolve + arguments schema
  -> expiry / cancellation
  -> capability preflight
  -> caller/global admission
  -> live probe
  -> local policy
  -> 必要时本地确认
  -> confirmation 后重新检查 expiry/cancel/probe/policy
  -> persistent claim
  -> claim 后最后检查 expiry/cancel
  -> handler
  -> JSON result / inline UTF-8 bytes 校验
  -> persistent outcome + redacted audit
```

handler 前失败也会持久化终态，从而让同一 `commandId` 重放得到原结果。并发重复调用共享同一个 in-flight
Promise；SQLite 中已为 running 的命令返回 `result_unknown`，不会再次触发副作用。
每个本地 descriptor 声明 caller/global 滑动窗口和 inline 结果字节上限；admission 在 confirmation
之前消费，避免靠未确认 command 填满 UI 队列。当前窗口只在进程内，不是上游 quota。

## Activity 投影与仅审计清除

- Activity 从 repository 按 occurredAt 倒序投影最近 100 条，只展示 caller subject id、occurredAt、
  path/tool、effect/risk、decision 和 outcomeCode；不展示 arguments、完整 outcome、commandId 或载荷。
- destructive confirmation 明确 clear 不可恢复及实际范围。`clear()` 的唯一 SQL 是
  `DELETE FROM audit_records`；commands/dedupe、timers、settings、installation identity 与 credential
  保持不变，也不会取消运行中命令、撤销网关或删除服务端审计。
- clear 返回 SQLite 的真实 changes；失败时 UI 不显示成功。DELETE 线性化后产生的新 audit 可以保留，
  不能因页面想显示空态而丢弃。
- `ApplicationRuntime` 在 clear 前递增 audit revision；更早启动的异步 refresh 即使晚返回，也不能把
  DELETE 前的旧列表重新发布。clear 后主动 refresh 获取当前真实列表。
- command 去重与 audit 生命周期分离：清除后 replay 同一副作用 commandId 仍读取持久化 outcome、handler
  不再执行，并新增 `decision: replayed` 的审计记录。

## 崩溃、保留与停用

- 初始化时把中断的 running command 恢复为 `unknown_after_crash/result_unknown`，不自动重放。
- timer 初始化严格按“恢复中断 command -> reconcile timers -> prune command 终态”执行；只有来源 command
  已成功、仍在未来且原生 pending 缺失的 `scheduled` timer 才以相同确定性 id rearm。crash orphan 只清理，
  不把未知副作用重放。
- 终态 command 总 cap 为 10,000。complete 的 UPDATE 成功后按 `receivedAt, commandId` 删除最老 eligible；
  running、当前刚完成 command、以及由 `preparing | scheduled | cancelling | status_unknown` 活动 timer
  引用的 source command 不进入删除候选，但其中终态仍计入 10,000，不是 cap 外附加记录。
- Memory command repository 每次 complete 维持等价的 10,000 终态硬上限并保留 running/当前完成项；
  production SQLite 另通过 timers 子查询保护活动 source。审计元数据写时硬上限仍为 5,000。
- emergency disable 先关闭本地策略闸门、取消进行中 handler、拒绝 pending confirmation，并停止当前
  attention/media session 与活动 timer、suspend SDK realtime；timer revocation epoch 防止已发起但迟到
  的原生调度越过停用边界。
- `LocalRevocationCoordinator` 先复用 emergency disable，再以有界超时停止 transports，并在 finally
  清凭证；SDK realtime 已存在但 coordinator/真实 pairing revoke 尚未接入生产入口，mailbox 也不存在，
  不能声称端到端撤销已经完成。

## 数据边界

- SQLite command 表不保存 arguments；audit 表不保存完整 arguments、坐标或 URL。
- timer 表只保存确定性 id、owner、来源 command、`firesAt` 与状态；确认用 `purpose` 不进入 DB、原生通知、
  command outcome 或普通 audit。
- opaque credential envelope 只由 SecureStore facade 管理；其结构不是上游 credential wire 契约。手工
  API key 不进入 SQLite、日志、审计、源码或 `EXPO_PUBLIC_*`；手工 credential 的 audience 优先于可选
  的非秘密 build origin。
- 手工配置从随机 installation UUID 派生 `mobile_<uuid>` SDK deviceId 与
  `manual_api_key_<uuid>` gateway principal。两者都是客户端声明值，不是网关签发身份或具体 Agent caller。
- confirmation coordinator 不持久化完整参数，也不等同于上游 mailbox 的 `awaiting_user` 状态。

## 相关文档

- `llmdoc/must/safety-boundaries.md`
- `llmdoc/reference/command-retention.md`
- `llmdoc/reference/local-activity-history.md`
- `llmdoc/reference/manual-gateway-configuration.md`
- `llmdoc/reference/sdk-device-transport.md`
- `llmdoc/reference/upstream-and-platform-blockers.md`
