# 本地 Activity 与仅审计历史清除

## 展示与保留

- Activity 页面按 occurredAt 倒序展示最近 100 条本地 audit metadata：caller subject id、occurredAt、
  path/tool、effect/risk、decision 与 outcomeCode。
- 页面不展示 command arguments、完整 outcome、commandId、坐标、URL、message/purpose、credential 或
  其他载荷；它是本机近期调用解释视图，不是 gateway 或服务端安全审计视图。
- 本机硬上限是 5,000 条。`SqliteAuditRepository.add()` 在同一个 SQLite exclusive transaction 内先
  INSERT，再按 occurredAt/id 裁剪超出上限的旧记录；上限不依赖下一次 App 启动才恢复。

## 清除范围

- 用户先在设备本地打开 destructive confirmation；确认文案说明操作不可恢复、只删除当前本机活动
  audit，并列出保留对象。
- repository 的 clear 只执行 `DELETE FROM audit_records` 并返回 SQLite `changes`。它不删除 commands /
  command outcome/dedupe、timers、settings、installation identity 或 credential，也不改变通知权限。
- clear 不取消进行中 command，不停止本地 effect，不撤销 pairing/transport，不清网关/服务端审计，也
  不满足完整数据删除或账户删除流程。
- SQL 失败时 runtime 抛错，Activity 保留已有记录并显示“未被确认删除”，不能用按钮意图冒充成功。
  空历史清除显示数据库真实的 0 条；DELETE 完成后新写入的 audit 继续保留。

## 并发与防重放

- `ApplicationRuntime` 在 DELETE 前递增 audit revision。refresh 捕获开始时 revision，发布 snapshot 前
  复核；clear 前开始、clear 后返回的旧读取因 revision 不一致被丢弃。DELETE 完成后 runtime 再 refresh。
- audit clear 与 command persistence 相互独立。已成功的副作用 command 在 clear 后用相同 commandId
  replay 时读取既有 outcome，handler 不再执行；这次读取产生新的 audit，decision 为 `replayed`。
- 该契约同时证明“清历史”不会恢复副作用执行资格；它不证明 gateway dedupe 或服务端 replay 语义。

## 已验证边界

- repository/component/local contract 覆盖写时裁剪、clear 的唯一 SQL、真实删除数、失败显示、DELETE 后
  新记录，以及“副作用一次 -> clear -> 同 id replay 仍一次并新增 replayed audit”；runtime 代码复核确认
  revision 会阻止 clear 前启动的 refresh 回写旧列表。
- API 36 fresh-install smoke 覆盖 Activity 的 100/5,000 范围文案、打开确认后取消、再次确认及真实
  “已清除 0 条”结果。它没有生成有记录的 SQLite clear，也不是 iOS、真机或服务端审计证据。

## 事实真源

- audit model/上限：`src/audit/types.ts`
- SQLite repository：`src/storage/auditRepository.ts`
- runtime revision：`src/runtime/applicationRuntime.ts`
- Activity UI：`src/ui/screens/ActivityScreen.tsx`
- replay contract：`test/contract/audit-history.contract.test.ts`
- 产品与验收：`docs/SECURITY.md`、`docs/ARCHITECTURE.md`、`docs/DOD.md`
- emulator 证据：`docs/verification/2026-08-19-android-emulator.md`
