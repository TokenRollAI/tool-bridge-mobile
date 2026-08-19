# 2026-08-19 手工 Gateway 配置验证

## 范围

验证 pairing 尚未交付时，首页手工输入 Gateway HTTPS origin 与 API key，并安全切换
`@tool-bridge/sdk/device@0.11.0` 前台 transport 的移动端实现。本文不把本地 fake WebSocket 或表单测试
写成真实 Gateway 认证、设备配对或真机网络证据。

## 已验证契约

- URL 只接受无 userinfo/path/query/fragment 的 HTTPS origin，并保存 canonical `URL.origin`；
- API key 只接受 1..16,384 字节范围内、不含空白的 printable ASCII token，不静默 trim secret；
- API key 输入使用遮蔽字段，保存成功后立即清空，不进入 UI snapshot、SQLite、普通 audit、日志、源码或
  `EXPO_PUBLIC_*`；
- 从 SecureStore installation UUID 派生稳定的 `mobile_<uuid>` SDK deviceId 与
  `manual_api_key_<uuid>` gateway principal；两者都不是网关签发身份或具体 Agent caller；
- 保存事件顺序为“停止旧 transport -> SecureStore save -> 连接新 audience”；
- 清除事件顺序为“停止 transport -> SecureStore clear -> 恢复可选非秘密 build origin”；
- SecureStore save/clear 失败时保持 transport 断开，错误反馈不含 API key；
- 切换 origin 会关闭旧 SDK socket，新建连接只把 API key 放入 Authorization header，URL 不含 secret；
- 手工 SecureStore audience 优先于 `EXPO_PUBLIC_GATEWAY_ORIGIN`，后者仍只能是非秘密 build preset。

## 自动化命令

工具链：Node 22.23.1、pnpm 11.21.0。

```bash
mise exec node@22.23.1 -- pnpm exec tsc --noEmit
mise exec node@22.23.1 -- pnpm exec eslint \
  src/identity/manualGatewayCredential.ts \
  src/gateway/manualGatewayConfigurationController.ts \
  src/gateway/sdkDeviceTransport.ts \
  src/runtime/applicationRuntime.ts \
  src/runtime/RuntimeProvider.tsx \
  src/ui/components/GatewayConfigurationCard.tsx \
  src/ui/screens/HomeScreen.tsx \
  'app/(tabs)/index.tsx' --max-warnings 0
mise exec node@22.23.1 -- pnpm exec jest --runInBand \
  src/identity/__tests__/manualGatewayCredential.test.ts \
  src/gateway/__tests__/manualGatewayConfigurationController.test.ts \
  src/gateway/__tests__/sdkDeviceTransport.test.ts \
  src/ui/components/__tests__/GatewayConfigurationCard.test.tsx \
  src/ui/screens/__tests__/HomeScreen.test.tsx
mise exec node@22.23.1 -- pnpm verify
```

结果：

- targeted TypeScript 与 lint：通过；
- targeted Jest：5 suites / 35 tests 全绿；
- 全量 docs/config/native module/SDK entry/secret/license/dependency mitigation/Expo/typecheck/lint：通过；
- 全量 Jest：52 suites / 221 tests 全绿；
- 本次未新增依赖、系统权限、entitlement、config plugin 或原生模块配置。

## 未证明

- 没有把任何真实 Gateway URL/API key 写入仓库或测试 fixture，因此尚未证明真实服务端接受鉴权、
  `mobile_<uuid>`、hello/expose/call/cancel/result 或权限 scope；
- 没有完成 pairing、device credential issuance/rotation/revoke 或 U-3 单次短期 ticket；
- 没有 Android/iOS 真机 header、前后台、弱网、断网恢复或长期重连证据；
- 本地清除只停止当前 transport 并删除本机 SecureStore envelope，不会撤销服务端 API key；
- 只有 SDK 收到真实 `ready` 后 App 才能显示 online；配置保存成功本身不等于连接或鉴权成功；
- 本地全量验证不替代本提交后的 clean-checkout CI、Android preview APK 或 artifact-to-commit 追溯。
