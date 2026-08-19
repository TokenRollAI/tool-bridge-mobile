# 本地运行时启动实现反思

## 任务

从以产品目标和 DOD 为主的仓库，建立可编译、可测试的移动脚手架与本地安全运行时，并把已完成项和
受上游/平台阻塞项同步回文档。

## 预期与实际

预期可以沿 DOD 推进移动 MVP。实际可独立完成的是本地策略、存储、确认、幂等和若干能力纵向切片；
pairing、production transport、mailbox、push 与 objectRef 缺少上游公共契约，iOS/双端真机也缺环境证据。

## 暴露的问题

- 原有详细文档同时描述目标架构、提案 API 和局部现状，进入任务时容易把“已设计”误判为“已实现”。
- DOD 有组合条目；只实现其中一半时，若只看关键词容易过度勾选。
- unit/local contract、native config、Android build、iOS build、真机行为和 gateway E2E 是不同证据层，
  过去没有一个短入口集中说明其边界。
- `installationId`、credential facade 和本地 revocation coordinator 很容易被误读为真实设备配对已经完成。

## 根因

仓库此前没有 llmdoc 启动包；高价值边界分散在 README、ARCHITECTURE、SDK、UPSTREAM、SECURITY 和
DOD。大范围探索可以找到事实，但难以让后续 Agent 快速保持同一套证据语言。

## 已提升的稳定知识

- `must/evidence-language.md` 固化四层证据与 DOD 勾选规则。
- `architecture/local-command-runtime.md` 固化 handler 前安全顺序、去重与 crash 语义。
- `reference/upstream-and-platform-blockers.md` 集中记录不能在本仓库伪造的外部契约和验证缺口。

## 后续

- 上游任何 U-1 至 U-7 状态变化时，先核实正式发布物和契约测试，再更新 blocker reference。
- iOS、真机或 CI 产生新证据时新增/更新日期化 verified-state，而不是覆盖历史为“始终已验证”。
- 若某类能力实现流程重复两次以上，再新增单一主题 guide；不要提前复制 `docs/` 的完整内容。
