# GitHub Preview 发布

## 定位

仓库用 `.github/workflows/release.yml` 把稳定 SemVer tag 转换为内部 GitHub Pre-release。它交付可直接安装、
不依赖 Metro 的 Android Preview APK 和 SHA-256，并以 iOS simulator build 作为共同代码/原生配置门禁。
它不是 production/store release。

## 版本不变量

- tag：`vX.Y.Z`；
- package version：`X.Y.Z`；
- `app.config.ts` 的 `APP_VERSION`：`X.Y.Z`；
- 发布说明：`docs/releases/vX.Y.Z.md`；
- Android `versionCode` 与 iOS `buildNumber` 显式维护，发版时不得倒退。

`pnpm verify:release-tag` 在普通 verify 中检查 package/App version 与发布说明；release workflow 另显式传入
`GITHUB_REF_NAME`，检查实际 tag 完全一致。不要让脚本自行读取通用 `GITHUB_REF_NAME`，因为 branch/PR
workflow 同样设置该变量。

## 发布顺序

1. 在功能分支运行 frozen install、`pnpm verify`、peer check 与 dependency audit；
2. 合并到 `main`，确认 clean-checkout verify、Android Preview APK 与 iOS simulator job 全绿；
3. 给合并后的 `main` commit 创建 annotated `vX.Y.Z` tag 并推送；
4. tag workflow 重跑所有门禁，双端 build 成功后才创建 GitHub Pre-release；
5. 下载 Release 的 APK 与 `.sha256`，独立核对 digest，并记录 workflow run、tag commit 和资产 URL。

Android/iOS build job 只需 `contents: read`；只有 publish job 使用 `contents: write`。仓库不得保存 GitHub
token、keystore、Apple certificate/profile 或 Gateway credential。

## 证据边界

GitHub Preview 成功只证明指定 tag 可从 clean checkout 通过仓库自动门禁并产出可追溯内部 APK。它不证明：

- production signer、AAB、IPA、商店提交或 staged rollout；
- APK/iOS 在物理设备完成权限、后台、锁屏、弱网与能力矩阵；
- 手工 Gateway URL/API key 已通过真实服务兼容验证；
- pairing、短期 ticket、mailbox、push 或服务端 revoke 已实现。

正式证据记录位于 `docs/verification/`；release notes 必须继续写清以上边界。
