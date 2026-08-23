# Preview 发布元数据门禁反思

## 任务与现场

在准备信箱正文容量修复的 Preview 发布时，远端 `main` 已合并并标记 `v0.0.7`，但 PR #14、合并后 main
workflow 和 tag release workflow 全部失败。失败点不是页面重构或原生构建，而是
`scripts/verify-app-config.mjs` 的 `releaseMetadata` 仍期望 0.0.6、Android 6、iOS 6；同一提交中的
`package.json` 与 `app.config.ts` 已更新为 0.0.7/7。

## 关键经验

### 1. 配置验证脚本也是受审阅的版本真源

仓库原有 release reference 列出 tag、package version、Expo App version、发布说明和平台 build number，
但没有点名 `scripts/verify-app-config.mjs` 的期望值。该脚本故意从外部验证 Expo public config，不能只把它
视为被动读取者；它的 `releaseMetadata` 实际上是必须同步更新的第四份受审阅元数据。

发版改动因此必须一起核对：

- `package.json` version；
- `app.config.ts` 的 App version、Android versionCode 与 iOS buildNumber；
- `scripts/verify-app-config.mjs` 的 `releaseMetadata`；
- `docs/releases/vX.Y.Z.md`；
- 最终 annotated tag `vX.Y.Z`。

### 2. 旧基线本地全绿不能证明最新 main 可发布

信箱容量修复最初位于已被 main 合并的旧 feature commit 上；该旧基线仍完整使用 0.0.6，所以本地
`pnpm verify` 通过。只有检查远端 main workflow 和失败日志后，才看见后续页面分支形成的 0.0.7 元数据
漂移。

准备 PR 和 tag 前必须 fetch/读取最新 main、已有 tag、开放或已合并 PR 与 Actions 状态，再把功能提交重放
到最新 main 后重新验证。旧工作树全绿只能证明旧基线与当前改动自洽，不能替代合并目标的 clean-checkout
门禁。

### 3. 已存在的失败 tag 不能被静默移动

`v0.0.7` 已作为 annotated tag 推到远端，即使对应 release workflow 失败，它仍是不可复用的发布身份。
后续修复必须使用下一个版本，而不是 force-move 或覆盖旧 tag。新 tag 只能指向合并后的 main commit，并在
main 的 verify、Android Preview 和 iOS simulator 门禁成功后创建。

## 提升候选

- release reference 明确列出配置验证脚本元数据，并把“检查远端已有 tag/Actions 状态”放到发布前置步骤。
- 若未来要消除重复值，应先保留独立验证能力，避免验证脚本与被测配置共享同一个错误来源后一起错误通过。
