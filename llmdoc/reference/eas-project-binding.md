# EAS 项目绑定参考

## 稳定身份

- Expo account/owner：`tokenroll`
- Expo project slug：`tool-bridge`
- EAS Project ID：`378c7a3e-437a-49a6-ae20-fef5af6f6188`
- Dashboard：`https://expo.dev/accounts/tokenroll/projects/tool-bridge`

Project ID 固定写入 `app.config.ts` 的 `extra.eas.projectId`。它是公开项目标识，不是凭证；Expo 登录态、
personal access token、Android keystore、Apple certificate/profile、APNs/FCM key 仍不得进入仓库。

## 多变体规则

development、preview、production 共用 owner、slug 和 Project ID。以下字段按变体隔离：

- application display name；
- Android application id；
- iOS bundle identifier；
- URL scheme；
- `APP_VARIANT` 与 EAS environment。

`eas.json` 锁定 EAS CLI 22.0.0 与 Node 22.23.1。preview 使用 internal distribution 和 Android APK；
production 保持 store-oriented 默认产物。不要在尚未评审 runtime/channel/rollback 前运行
`eas update:configure`。

## 验证

```bash
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas project:info
mise exec node@22.23.1 -- pnpm --package=eas-cli@22.0.0 dlx eas config --platform android --profile preview
pnpm verify
```

预期 `project:info` 返回 `@tokenroll/tool-bridge` 与上述 UUID；preview resolved profile 返回
`environment=preview`、`APP_VARIANT=preview`、Node 22.23.1、`distribution=internal` 与 `buildType=apk`。

## 证据边界

EAS 关联只证明云项目身份和构建配置可解析。它不证明云构建成功、签名可用、APK 可安装、iOS 设备已
注册、EAS Update 已启用、APNs/FCM 已配置或 production transport 已接通；这些结论必须分别由 build、
credential、真机与上游集成证据支持。

