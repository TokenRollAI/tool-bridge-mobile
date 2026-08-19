# 2026-08-19 GitHub Preview 发布反思

## 背景

首个可安装版本需要同时满足两个目标：让内部用户能通过 GitHub Release 直接取得 APK，又不能把 debug
test key、simulator build 和尚未接真实 Gateway 的状态包装成 production release。

## 暴露的问题

- `package.json` 原为 `0.0.0`，Expo App version 原为 `0.1.0`；若直接打 tag，版本来源会分叉。
- 普通 branch / pull request Actions 也会设置 `GITHUB_REF_NAME`。把该环境变量无条件当成 tag，会让日常
  `pnpm verify` 把分支名误判为版本不匹配。
- “CI 能构建 APK”与“tag 已经经过相同门禁并发布”是两份证据；前者不能替代后者。
- 内部 Preview APK 仍使用 debug test key。即使 GitHub Release 自动化成功，也不能勾 production signer、
  AAB/IPA、商店提交、真机矩阵或 staged rollout。

## 处理原则

- `package.json` 与 `app.config.ts` 共享同一人工审阅的稳定 SemVer，并把平台 build number 单独显式化。
- 日常 verify 只检查版本和对应 release notes 存在；tag workflow 必须显式把 tag 作为参数传入校验，不能
  从分支通用环境变量猜测。
- tag 必须落在合并后的 `main` commit。发布 job 等 verify、Android Preview APK、iOS simulator 全部成功
  后才运行，并且只有这个最终 job 获得 `contents: write`。
- `v0.0.1` 固定标为 GitHub Pre-release，附件使用 Preview application id、版本化文件名与 SHA-256；发布
  说明必须列出真实 Gateway、pairing、production signing、真机和商店边界。

## 可复用经验

- 发布自动化先统一版本真源，再谈 tag；否则 artifact、App metadata 和 Release 名称无法可靠追溯。
- release-specific 输入应显式传递，不能隐式复用所有 CI 事件都存在的变量。
- 权限提升应放在最后一步：build job 只读，publish job 才能写 Release。
- “自动发布成功”描述的是可追溯交付渠道，不是产品成熟度或生产资格。
