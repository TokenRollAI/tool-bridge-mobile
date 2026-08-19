# 2026-08-19 本地 timer 恢复与竞态反思

## 背景

本次切片不是“延迟调用一次 notification API”，而是把远程 command、SQLite 意图、App 生命周期和系统
notification pending 集合协调成一个可恢复、可撤销且不夸大结果的本地状态机。

## 有效做法

### 1. 先定义不可声称的事实

绝对 DATE trigger 只说明系统接受了 best-effort 调度。先禁止 fired/delivered/presented/clicked/on-time，
再设计 start/cancel/status 结果，能避免用字段名暗示平台没有提供的确认语义；也自然排除了为“准时”偷偷
引入 exact alarm、boot receiver 或远程 push 的诱惑。

### 2. 把三个事实面分开对账

command 终态回答“这次副作用是否已被运行时记录为成功”，timer 表回答“App 想维持什么意图”，native
pending 集合只回答“现在能否观察到这个 identifier”。只有 command succeeded、timer scheduled、仍在未来
且 native missing 同时成立，rearm 才安全。中断 command 即使留下 preparing/native orphan，也只能清理，
不能用“可能没执行”作为重放理由。

### 3. 恢复顺序本身就是数据契约

`recoverInterruptedCommands -> reconcileTimers -> pruneTerminalCommands` 不是启动优化细节。若先 prune，
source command 的成功/未知证据会丢失，reconcile 只能猜测；把顺序固定并测试，比给状态机增加模糊兜底
更可靠。

### 4. timeout 不会取消已经发给平台的 Promise

本地 5 秒 timeout 或 AbortSignal 只能停止等待，不能保证 Expo/native schedule 没有稍后成功。因此原始
Promise 的 finally cleanup、确定性 native id、CAS 失败补偿与 emergency revocation epoch 必须一起存在。
同理，cancel API 失败不能回滚成 scheduled 成功，只能显式落入 status_unknown。

### 5. 隐私最稳妥的边界是根本不传

`purpose` 只为用户确认服务。固定原生 title/body，并让 migration、adapter result、command outcome、audit
从类型上都没有 purpose，比依赖每层日志脱敏更容易审查；同一原则也让 crash recovery 不需要处理敏感
payload。

## 后续复用检查

- 新增任何可延期副作用时，先列出 command、App persistence 与 platform queue 各自能证明什么。
- 对可迟到的 native Promise，同时审查 abort、timeout、CAS failure、disable/revoke 与进程重启路径。
- rearm/retry 必须以已持久化成功证据和确定性 id 为前提，未知副作用默认清理而非重放。
- 把平台接受、当前 pending、用户可见和用户交互拆成不同术语；缺少平台证据时保留 unknown。
- 真机/Doze/reboot/presentation 验收完成前，不把 unit、build 或 capability smoke 升格为时序保证。
