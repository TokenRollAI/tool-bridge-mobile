# 2026-08-19 GitHub Preview 发布流水线

## 目的

为 `vX.Y.Z` tag 建立可追溯的内部 GitHub Pre-release 流水线。它交付 Android Preview APK 与 SHA-256，
并把 iOS simulator build 作为发布门禁；它不生成 production AAB/IPA，不上传商店，也不替代正式签名、
真实 Gateway、双端真机、安全合规或 Release DOD。

## 已有 CI 基线

功能 commit `a4edb73` 的
[GitHub Actions run 32239849273](https://github.com/TokenRollAI/tool-bridge-mobile/actions/runs/32239849273)
已从 clean checkout 验证：

- frozen `pnpm install`、全量 `pnpm verify`、peer check 与 dependency audit 成功；
- Android Preview APK clean build、SHA-256 生成与 artifact 上传成功；
- iOS simulator clean build 成功；
- artifact `9360956142` 的 workflow head SHA 是 `a4edb73`，APK SHA-256 为
  `802a3e8cbd9de1378f0295c22c26bfcef7effe2002f203302f195e372d009165`。

这份基线证明当前 commit 的 clean-checkout CI 与双端编译门禁可复现，不证明 release workflow 本身已经
被 tag 事件执行。

## `release-preview` 设计

1. tag 必须匹配 `vX.Y.Z`，且 tag commit 必须可从 `main` 到达；
2. `scripts/verify-release-tag.mjs` 要求 tag、`package.json`、Expo `APP_VERSION` 与
   `docs/releases/<tag>.md` 一致；
3. verify job 使用锁定 Node 22.23.1 / pnpm 11.21.0，执行 frozen install、全量 verify、peer 与 dependency
   gate；
4. Android 与 iOS 在 verify 后并行 clean build；Android 只生成 preview application id 的 APK；
5. 两端都成功后，最终 job 才取得最小 `contents: write` 权限，使用已有 tag 创建 GitHub Pre-release；
6. Release 同时附版本化 APK 与 `.sha256`，workflow artifact 保留 30 天。

## v0.0.1 发布前检查

```bash
mise exec node@22.23.1 -- pnpm verify:release-tag v0.0.1
mise exec node@22.23.1 -- pnpm install --frozen-lockfile
mise exec node@22.23.1 -- pnpm verify
mise exec node@22.23.1 -- pnpm peers check
mise exec node@22.23.1 -- pnpm audit:dependencies
```

tag 必须落在合并后的 `main` commit；不能给未合并分支或未经该流水线验证的本地产物补写同名 Release。

## 明确未覆盖

- production keystore、Apple certificate/profile 或受控签名 secret store；
- Android AAB、iOS archive/IPA、App Store Connect、Google Play 或 EAS Submit；
- SBOM、provenance attestation、release APK 真机安装 smoke、staged rollout 与 rollback 演练；
- Gateway compatibility matrix、pairing/rotation/revoke、双端真机和 24 小时稳定性；
- GitHub tag/release immutable repository policy；tag 仅按流程纪律禁止移动。
