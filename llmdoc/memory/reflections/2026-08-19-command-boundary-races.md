# 本地 command 异步边界反思

## 任务

审计并收紧所有已注册本地 capability 的速率、结果、取消、到期与撤销行为，判断两个组合安全 DOD
是否已有直接证据。

## 错误假设

最初执行链在 schema 后和 confirmation 后都检查了取消/到期，容易据此认为 handler 前没有竞态。实际
`commandRepository.claim()` 本身是异步边界：等待 SQLite 事务期间 command 仍可取消或到期，而旧代码
在 claim 返回 `started` 后直接进入 handler。

类似地，executor 只在开始前理解 command `expiresAt`，handler invocation 没有 deadline。attention
按自己的 duration 运行、location 按自己的 timeout 等待，都可能越过更早的 command deadline。

## 暴露的问题

- 安全检查不是“写过一次就完成”；每个可能等待外部状态的 await 后都要判断是否形成新的 TOCTOU。
- rate limit 若放在 capability execute 内，会发生在本地确认之后，攻击者仍可先占满确认队列。
- `z.json()` 只证明结构可序列化，不限制 UTF-8 字节，意外 native 大结果仍可进入 SQLite。
- emergency disable 只停止已知 session 时会漏掉 location 等进行中的 handler。
- revoke 若等待一个永不 settle 的 transport，凭证清理就永远到不了；“best effort”也必须有时限。

## 实现结果

- claim 返回后最后复检取消/到期；已 claim 但未执行的命令直接完成为 cancelled/expired，不二次 claim。
- invocation 传播 command deadline；attention 取 session duration/deadline 较早值，location 截断实际等待。
- executor 为唯一 command 创建内部 AbortController；emergency disable 可取消全部进行中 handler。
- 每个 descriptor 声明 caller/global rate 与 inline result bytes；admission 在 probe/confirmation 前消费，
  UTF-8 JSON 超限转换为小型 `result_too_large` 终态。
- local revoke 复用 emergency disable，以有界 timeout 停 transports，并在 finally 清 SecureStore credential。

## 证据上限

25 suites / 85 tests 与 Android emulator smoke 已通过，但两个组合 DOD 仍不能勾选：admission 窗口当前
只在进程内；media 仍缺最终 URL/MIME/实际字节预检；真实 realtime/mailbox 尚未接入 revoke。局部 race
关闭不能外推为 production transport 或完整媒体安全已经完成。

## 已提升的稳定知识

- `must/safety-boundaries.md` 增加 claim 后复检、confirmation 前 admission、结果字节与 deadline 传播。
- `architecture/local-command-runtime.md` 更新实际执行顺序、cancel-all 与有界 revoke stop。
- `reference/verified-state-2026-08-19.md` 更新可复现测试基线，同时保留上游/真机限制。
