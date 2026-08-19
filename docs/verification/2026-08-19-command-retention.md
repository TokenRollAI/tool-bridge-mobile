# 2026-08-19 command retention 验证

## 范围

本记录验证生产 `SqliteCommandRepository` 的终态写入/裁剪 SQL 形状，以及同等 SQL 在真实 SQLite
引擎中的计数和保护语义。它不替代 Android/iOS 文件数据库压力测试，也不把有限 tombstone retention
解释为网关级永久防重放。

## 自动化

锁定 Node 22.23.1 下的定向仓储、内存 retention 与 timer contract 共 11 项通过；随后完整
typecheck、lint 与 Jest 通过，共 43 suites / 175 tests。

覆盖点：

- `complete` 的 UPDATE 与 prune 使用同一个 exclusive transaction；
- UPDATE 未命中时 transaction 拒绝且不执行 prune；
- 总终态数持续限制为 10,000，不把受保护项额外加在上限之外；
- running、当前刚完成的 command 与活动 timer source command 不进入删除候选；
- 内存仓储在每次 complete 后执行同等硬上限，显式 startup prune 随后返回 0；
- 刚完成但 receivedAt 很早的 command 不会在自己的完成 transaction 中立刻被删除；
- timer replay/reconciliation contract 没有因 retention 改动回归。

## SQLite 计数夹具

本机 `/usr/bin/sqlite3` 版本为 3.51.0。内存数据库插入 10,001 条终态、1 条 running，并把最旧终态
设为 active timer source；再执行与 production 相同的 DELETE 子查询，保护当前刚完成的第 10,001 条。
结果：

```text
terminal|10000
protected|1
current|1
running|1
oldest_eligible|0
```

这证明 SQL 语法可执行，且超额一条时删除最老可淘汰记录，同时保留 timer source、当前完成项和
running。该 host SQLite 夹具不证明 Expo SQLite 的移动端 I/O、锁争用或 10,000 条真实设备性能；这些
属于后续设备压力/性能证据。
