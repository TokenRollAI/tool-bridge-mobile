# 2026-08-23 SDK device wire 兼容验证

## 范围与工具链

本记录只验证 `@tool-bridge/sdk/device@0.14.1` 的新 call `path/context` 在当前工作树、
Android Preview 和当前 Railway Gateway `status/get` 路径上的兼容性。

- Node.js：22.23.1；
- pnpm：11.21.0；
- Java：Temurin 17.0.20+8；
- ADB：1.0.41 / platform-tools 37.0.1；
- 设备：USB 连接 Android 物理设备；
- App：`ai.tokenroll.toolbridgemobile.preview` 0.0.6（versionCode 6）。

本记录不包含 Gateway URL、SK、Authorization、SecureStore material、完整 installationId 或
敏感 command arguments。

## 依赖与仓库门禁

- `@tool-bridge/sdk` 由精确版本 0.11.0 升级为 0.14.1；registry 发布包为 MIT，`./device`
  export 的 types/react-native/import 均指向 `dist/device.*`。
- `pnpm verify:sdk-device` 通过：`dist/device.js` 的外部 import 仍只有 `partysocket/ws`，
  没有 Node `ws` 或 `process.env` 泄漏。
- 首次 `pnpm verify` 在前置门禁通过后，被 `expo install --check` 拒绝：SDK 57 当前
  兼容表要求 Expo 57.0.15 及 10 个配套模块各升一个 patch。精确升级后重新生成
  lockfile，未跨 Expo SDK，未新增权限面。
- `pnpm install --frozen-lockfile` 通过。
- 最终 `pnpm verify` 通过：typecheck、lint 全绿，Jest 为 64 suites / 294 tests。Jest 输出
  open-handle 提示，但进程退出码为 0；本记录不将它隐去或改写为“无告警”。

## Bundler 与 Android Preview

- `pnpm build:android:preview` 从 clean Expo prebuild 成功：`BUILD SUCCESSFUL in 2m 42s`，
  944 个 Gradle task 全部执行，Android production Metro 为 1,562 modules。
- APK：`android/app/build/outputs/apk/release/app-release.apk`，SHA-256
  `84dafa12b8dcd7d23abb9d22438bf57a5257ee2ceb06078c9c183747abe7c8f9`。
- `aapt` 证明 package 为 `ai.tokenroll.toolbridgemobile.preview`，versionName/versionCode 为
  `0.0.6/6`，min/target SDK 为 24/36。
- APK 包含 `assets/index.android.bundle`；`apksigner verify --verbose --print-certs` 通过，v2 签名有效，
  signer certificate SHA-256 为
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。该签名是内部 debug
  test key，不是 production signer。
- iOS production Metro/Hermes export 成功：1,441 modules，产出约 4.1 MiB `.hbc`。这不是
  iOS 原生 build 或真机证据。

## 保数据覆盖安装与 UI

1. `adb devices -l` 只显示一台 USB 真机且状态为 `device`。
2. 安装前的 Preview 为 0.0.5；拉取已安装 base APK 并核对 signer certificate SHA-256，
   与新 0.0.6 APK 完全一致。
3. 只执行 `adb install -r android/app/build/outputs/apk/release/app-release.apk`，返回 `Success`；
   未执行 uninstall、`pm clear` 或凭证删除。
4. 覆盖后 versionName/versionCode 为 0.0.6/6，`firstInstallTime` 保持 2026-08-20 06:10:08；
   冷启动后原 deviceId `9daf921003a4` 与挂载路径均保留，且 App 无需重新录入
   credential 即恢复 online，因此覆盖安装保留了 App data 与 SecureStore credential。
5. 冷启动为 `LaunchState: COLD`；UI 显示 `deviceId=9daf921003a4`、连接 `online`、
   前后台 `active`，真实调用前后的 hierarchy 均未出现 `protocol_error`。

## 单次真实 Gateway 调用

按 Tool Bridge live help 先核对 exact path：

- path：`device/phone/9daf921003a4/status/get`；
- effect：`read`；
- input schema：严格空对象；
- feedback：调用前列表为空，没有 workaround 或已知异常需要应用。

随后只执行一次：

```text
tb call device/phone/9daf921003a4/status/get --json
```

进程成功退出，且返回对象严格通过 live output schema 检查：

- `platform=android`；
- `appState=active`；
- `reachability=online`；
- `controlMode=direct_call`；
- battery 为 available：正在充电、电量约 0.76、非低电量模式；
- network 为 available：Wi-Fi、`internetReachable=true`；
- `observedAt` 是有效 UTC 时间戳；
- `installationId` 字段存在且非空，本记录不保存其完整值。

没有重试、没有 feedback 写入，没有修改 Gateway/Railway 配置或凭证。

## 结论与未验证项

已验证：`@tool-bridge/sdk/device@0.14.1` 新版直连 device wire 与当前 Railway Gateway
的 Android `status/get` 路径已完成真机兼容验证。

未验证：除 `status/get` 外的所有能力、iOS 原生构建/真机、后台与锁屏、弱网/重连、
长时间稳定性、pairing/rotation/revoke、mailbox、push 与完整 Gateway compatibility matrix。

本轮未发布 npm、GitHub Release、EAS build 或 git tag，也未提交代码。
