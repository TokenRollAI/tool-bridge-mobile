# 2026-08-19 retention 与 accessibility 证据反思

## 背景

本轮同时收紧两类容易被“看起来合理”掩盖的边界：长驻进程中的 command tombstone 上限，以及 common
React Native UI 的 accessibility semantics。前者关系到防重放状态是否持续有界，后者关系到自动化能否
诚实描述可访问性，而不是把局部语义测试写成平台验收。

## 稳定经验

### 1. “受保护”不等于“额外赠送容量”

retention SQL 必须先按全部 terminal command 计算超额数量，再从 eligible 集合删除最老记录。running、
当前刚完成项和活动 timer source 不能成为删除候选，但它们中的终态仍计入 10,000 总 cap。若按 eligible
数量计算上限，文档中的 10,000 会悄悄变成 10,000 加若干 protected，失去硬上限含义。

### 2. 保留策略要与产生终态的写入线性化

只在 App 启动 prune 会让长驻进程无限积累。`complete` 的 terminal UPDATE 与 prune 放在同一 exclusive
transaction，既保证结果落库后立即恢复上限，也保证 UPDATE 失败时不会独立裁剪。当前完成项必须临时
排除，否则 receivedAt 很老的迟到完成命令可能在自己的 transaction 中被立刻删掉，恢复副作用资格。

### 3. 语义自动化不是辅助技术的实际体验

component test 可以证明 header、组合名称、role/state、48dp 和公告去重；UIAutomator 可以证明 Android
语义节点、selected state、bounds 与 200% 字号下仍可操作。但它们没有启动 TalkBack/VoiceOver，也不能
证明实际朗读、手势/rotor 顺序、Switch Access 或 iOS Dynamic Type。证据措辞必须停在自动化基线。

### 4. accessibility announcement 也是数据出口

自动公告应只描述安全相关的离散变化，并按 semantic key 去重。confirmation detail、message/purpose、
倒计时和媒体进度若进入公告，不仅会刷屏，还可能把敏感内容送入辅助技术通道；因此“什么不公告”与
role/label 同样需要契约测试。

## 后续复用检查

- retention 变更同时检查计数母集、删除候选集、排序、当前写入保护和依赖记录保护。
- 用真实 sqlite3 fixture 复核复杂 DELETE 子查询，但不把 host SQLite 结果外推为移动端 I/O/性能证据。
- accessibility 结论分别标注 component、语义树 emulator、平台辅助技术和真机人工验收层级。
- 新增动态 UI 时先定义离散 semantic key，再审查 announcement 是否包含敏感正文或高频数值。
- 当前工作树只有 Jest 数字时，只记 Jest；最终 `pnpm verify` 未结束就不能写文档/config/lint 等全链路已过。
