# Command 终态 retention 参考

## 写入与总 cap

- `LOCAL_COMMAND_RETENTION_LIMIT` 为 10,000。`SqliteCommandRepository.complete()` 在一个 SQLite
  exclusive transaction 内先把唯一 running command 写为终态，再执行 retention DELETE；UPDATE 未命中
  时 transaction 拒绝且不继续 prune。
- 超额数量按全部 `status <> 'running'` 的 command 计算，因此 10,000 是终态总 cap。受保护的当前完成项
  和活动 timer source 仍计入这 10,000，只是本次不进入 deletion candidate；不是
  `10,000 + protected`。
- eligible 记录按 `received_at ASC, command_id ASC` 确定性删除最老项。所有 running、当前刚完成的
  command，以及被 `preparing | scheduled | cancelling | status_unknown` timer 引用的 source command
  都受保护，避免删除尚在执行、刚落终态或仍需 timer reconciliation 的防重放事实。
- 显式 startup `pruneTerminal()` 复用相同 terminal 计数、timer source 保护和 oldest-eligible 规则；timer
  启动顺序仍是 command recovery -> timer reconcile -> command prune。

## 内存实现与证据

- `MemoryCommandRepository` 在每次 complete 后同步维护 10,000 个 terminal hard cap，保留 running 和
  当前完成项；它用于本地 contract/retention parity，不包含 production SQLite 的 timer JOIN 语义。
- repository tests 验证 UPDATE/prune 同 transaction、UPDATE 失败不 prune、SQL candidate 保护与排序；
  retention tests 连续完成 10,050 个 command，证明每次完成后 terminal 不超过 10,000，且很老但刚完成
  的 command 不会在自己的 complete 中立即被删。
- `/usr/bin/sqlite3` 3.51.0 fixture 对 10,001 个 terminal、1 个 running、1 个 active timer source 执行
  production 等价 DELETE 后得到 terminal 10,000，同时保留 running、current 与 protected source，并删除
  oldest eligible。它验证 SQL 语法/计数，不证明 Expo SQLite 真机锁争用、I/O 或 10,000 条性能。
- 有界本地 tombstone 不等于网关级永久 dedupe；被 retention 合法淘汰的旧 id 是否可重用仍需要上游协议
  和保留策略定义。

## 事实真源

- 常量与接口：`src/commands/repository.ts`
- SQLite 实现：`src/storage/commandRepository.ts`
- 内存实现：`src/storage/memoryRepositories.ts`
- 自动化：`src/storage/__tests__/commandRepository.test.ts`、`src/storage/__tests__/retention.test.ts`
- fixture 记录：`docs/verification/2026-08-19-command-retention.md`
- 安全/验收：`docs/SECURITY.md`、`docs/DOD.md`
