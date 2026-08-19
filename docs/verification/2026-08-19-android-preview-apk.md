# 2026-08-19 Android preview APK 验证记录

## 范围

本记录证明当前工作树可生成 application id 隔离、内嵌 JavaScript、可直接安装的 Android preview
APK，并在 API 36 emulator 上冷启动到本地运行时首页。该包用于内部体验，不是生产签名、Play 商店
构建、物理设备验收或 release DOD 证据。

## 命令与环境

```sh
mise exec java@temurin-17.0.20+8 android-sdk@22.0 node@22.23.1 -- \
  pnpm build:android:preview
```

- macOS arm64 host；
- Node 22.23.1、pnpm 11.21.0、Temurin 17.0.20+8；
- Android build tools / compileSdk / targetSdk 36，minSdk 24；
- `APP_VARIANT=preview`、`NODE_ENV=production`；
- Gradle `assembleRelease`，由 Expo prebuild 生成的 debug test key 签名。

## 构建和产物

- `BUILD SUCCESSFUL in 6m 5s`；
- 903 个 Gradle task：871 executed、32 up-to-date；
- Metro 在 `createBundleReleaseJsAndAssets` 中构建 1,523 个 module；APK 包含
  `assets/index.android.bundle`，不是依赖本地 Metro 的 development APK；
- 输出：`android/app/build/outputs/apk/release/app-release.apk`；
- 大小：109,966,791 bytes；
- SHA-256：`84e8a6e7db045cbe466d3787b638426e329d7279f495e011427516cdb2584b53`；
- package：`ai.tokenroll.toolbridgemobile.preview`；
- versionCode / versionName：`1` / `0.1.0`；
- label：`Tool Bridge Mobile (Preview)`；
- 签名验证：APK Signature Scheme v2，单一 `CN=Android Debug` signer；证书 SHA-256：
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。

## 安装 smoke

APK 在 Android 16 / API 36 arm64 emulator 上 `adb install -r` 成功。显式冷启动
`ai.tokenroll.toolbridgemobile.preview/.MainActivity` 返回 `Status: ok`，preview 进程与 Activity 保持前台；
页面语义树显示：

- “当前仅启用本地安全运行时”；
- `可达性：unconfigured`；
- `控制模式：ask_every_time`；
- 状态、能力、媒体、活动四个标签页。

启动窗口内未观察到该 preview 进程的 `FATAL EXCEPTION`。这证明嵌入 bundle 可加载到首页，不证明
媒体、位置、通知、timer、地图 handoff、后台或锁屏行为在物理设备有效。

## CI artifact

`.github/workflows/verify.yml` 的 `android-preview-apk` job 在 verify 成功后运行同一构建脚本，将 APK
复制为 `tool-bridge-mobile-preview.apk`，同时生成 SHA-256 文件并通过
`actions/upload-artifact@v7.0.1` 保留 14 天。只有远端 workflow 实际成功后，才能把对应 GitHub
artifact 写成 CI 已交付；本地记录不替代该远端证据。

## 未覆盖

- debug test key 不是生产密钥；相同 application id 的后续包若使用不同 key，Android 不允许覆盖安装；
- 尚未在 Android 真机安装，也未覆盖 DND、权限撤销、物理 haptic/音频、后台、锁屏或低电量；
- production transport 仍为 `unconfigured`，没有 pairing、realtime、mailbox 或 remote push；
- 没有 iOS build、签名或真机证据；
- 没有 Play App Bundle、正式签名、SBOM、provenance、staged rollout 或商店合规证据。
