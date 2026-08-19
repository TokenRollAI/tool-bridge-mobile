# 2026-08-19 SDK device integration 验证

## 范围

验证 `@tool-bridge/sdk@0.11.0` 的 React Native `/device` 子入口、移动 consumer wiring、依赖边界与
Android/iOS Metro 兼容。本文不把 fake WebSocket 或 Metro 成功写成真实 gateway/真机证据。

## 依赖与公开契约

- npm 精确版本：`@tool-bridge/sdk@0.11.0`，MIT，repository 为 `TokenRollAI/tool-bridge/packages/sdk`；
- package export：`./device` 的 types 为 `dist/device.d.ts`，`react-native/import/default` 为
  `dist/device.js`；
- 公开入口导出 `connectDevice`、`createReactNativeWebSocketFactory`、frame codec、TBError 与相关类型；
- registry tarball 的 device bundle 只有 `partysocket/ws` 外部 import，没有 Node `ws` 或
  `process.env`；
- package 仍声明 Node `>=22`，由本仓库构建环境 Node 22.23.1 满足；React Native runtime 不运行 Node。

新版本处于默认 release-age 等待期内；`pnpm-workspace.yaml` 仅对精确 0.11.0 设例外。例外依据为已核对
registry tarball/integrity、上游源码/README/测试、MIT license、移动 consumer contract 与双端 Metro。

## 锁定工具链验证

工具链：Node 22.23.1、pnpm 11.21.0。

```bash
mise exec node@22.23.1 -- pnpm install --frozen-lockfile
mise exec node@22.23.1 -- pnpm verify
mise exec node@22.23.1 -- pnpm audit:dependencies
```

结果：

- frozen install：通过，lockfile 无变化；
- docs/config/native module/SDK entry/secret/license/dependency mitigation/Expo/typecheck/lint：全绿；
- Jest：49 suites / 200 tests 全绿；
- dependency audit：1 moderate；2 个已由现有补丁、恶意样本回归和定向 policy 豁免的 high；没有新增未
  处理的 high gate failure；
- SDK entry gate 明确输出：`@tool-bridge/sdk/device@0.11.0` 独立 RN export，无 Node
  `ws/process.env` 泄漏。

## Consumer contract

`src/gateway/__tests__/sdkDeviceTransport.test.ts` 使用真实 `connectDevice` supervisor 和 fake raw
WebSocket 验证：

- SecureStore envelope material 只进入 Authorization header，URL 只有非秘密 deviceId；
- hello 携带 registry 投影的 `DeviceExpose`，ready 后状态才为 online；
- call id/path/tool/arguments/signal 进入本地 command adapter，result 使用同一 id；
- 本地 Disabled 错误映射为规范 `permission_denied`；
- background 触发 SDK suspend；
- SecureStore 读取等待期间收到 Disabled 会使旧 lifecycle revision 失效，zero WebSocket；
- credential 缺失或 audience mismatch 时 zero WebSocket；
- registry 使用 strict Zod schema 生成官方 `inputSchema`，并验证全部当前 capability schema 都可转换，
  不添加私有 frame/profile 字段。

## 双端 Metro

```bash
APP_VARIANT=preview NODE_ENV=production mise exec node@22.23.1 -- \
  pnpm exec expo export --platform android --output-dir dist/sdk-device-android-node22
APP_VARIANT=preview NODE_ENV=production mise exec node@22.23.1 -- \
  pnpm exec expo export --platform ios --output-dir dist/sdk-device-ios-node22
```

结果：

- Android：1,527 modules，Hermes bundle 约 4.3 MB，export 成功；
- iOS：1,396 modules，Hermes bundle 约 4.0 MB，export 成功；
- Expo 在写完产物后报告有句柄未退出并主动结束进程，但两个命令均以成功状态返回且产物/metadata 完整。

`dist/` 被 gitignore，不进入仓库或 release artifact。

## 未证明

- 没有 pairing UI 或上游签发流程，fresh install 没有可用 device credential；
- 没有真实 gateway compatibility、Agent caller/deadline attribution、弱网/拒绝/长期重连测试；
- 当前 RN header 使用持久 device credential，不是 U-3 单次短期 ticket；
- 没有 mailbox、push、动态 profile 或 objectRef；
- Metro 不是 Android/iOS 原生 build；没有双端真机 header、前后台或系统挂起证据；
- 早先 Android APK 不包含本次改动，必须由本提交后的 CI/EAS 新 artifact 才能用于试用。
