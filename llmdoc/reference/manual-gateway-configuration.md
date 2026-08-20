# 手工 Gateway 配置参考

## 当前用途

正式 pairing/U-2 尚未交付时，首页允许用户手工输入 Gateway HTTPS origin 与 API key，直接驱动
`@tool-bridge/sdk/device@0.11.0` 前台连接。它是内测 fallback，不是 pairing、设备凭证签发、最小 scope、
rotation/revoke 或 U-3 短期 ticket。

## 输入与身份

- URL 只接受无 path/query/fragment/userinfo 的 HTTPS origin；首尾空白可规范化，最终保存 `URL.origin`。
- API key 长度为 1..16,384，只允许不含空白的 printable ASCII；不静默 trim 或规范化 secret。
- API key 输入框遮蔽，保存成功立即清空；UI snapshot 和 announcement 不包含 secret。
- 客户端声明的 SDK deviceId 默认由设备硬件标识（Android ID / iOS IDFV）加域分隔盐经 SHA-256 截断
  派生为 12 位十六进制短 ID，跨重装稳定；硬件标识不可用时回退 SecureStore `installation_<uuid>` 派生。
  用户可在表单自定义 deviceId，只接受 `[A-Za-z0-9._-]{1,64}`（与网关 `assertDeviceId` DO 路由约束一致）。
- 设备在 hello 中声明 `mountPath: device/phone/<deviceId>`；expose node 去掉 `phone/` 前缀，
  相对 call path 进入本地 executor 前补回，`phone/*` 本地规范命名空间与 SQLite 历史格式不变。
- `manual_api_key_<uuid>` 只是同一安装实例的 gateway principal/local caller bucket，不是具体 Agent 身份。

## 存储与优先级

- `audienceOrigin/deviceId/keyId/material/version` 使用现有 `DeviceCredentialEnvelope` 写入
  `expo-secure-store`；API key 不进入 SQLite、AsyncStorage、普通审计、日志、crash report、源码或
  `EXPO_PUBLIC_*`。
- 手工 SecureStore envelope 的 audience 优先于可选 `EXPO_PUBLIC_GATEWAY_ORIGIN` 构建预置。
- 构建变量只可保存非秘密 URL；清除手工 key 后，如果存在 build origin，transport 回到
  `credentials_required`，否则回到 `unconfigured`。

## 配置切换不变量

保存：

```text
validate URL + key + installation identity
  -> transport.updateConfiguration(null)
  -> SecureStore.save(envelope)
  -> transport.updateConfiguration(new origin)
  -> apply current AppState / control mode
```

清除：

```text
transport.updateConfiguration(null)
  -> SecureStore.clear()
  -> transport.updateConfiguration(optional build origin)
  -> apply current AppState / control mode
```

SecureStore 写入或删除失败时不得自动重连；错误文案不包含底层 secret。Disabled 状态允许本地保存或
清除，但新 transport 保持 suspended，直到用户恢复控制模式。

## 代码位置

- `src/identity/manualGatewayCredential.ts`：输入规范化、派生标识和 envelope。
- `src/gateway/manualGatewayConfigurationController.ts`：停止/存储/重连顺序。
- `src/gateway/sdkDeviceTransport.ts`：动态 gateway origin 与 official SDK connection。
- `src/runtime/applicationRuntime.ts`：SecureStore、transport、AppState/control mode 组装。
- `src/ui/components/GatewayConfigurationCard.tsx`：遮蔽录入、清除确认和非秘密反馈。

## 验证与未证明

unit/component/fake WebSocket 已覆盖 strict 输入、secret 清空、成功/失败事件顺序、旧 socket 关闭和新
audience header。`pnpm verify` 仍是本地 gate。

没有真实 gateway URL/API key、真机 header、弱网/重连、服务端 permission matrix 或 revoke 证据时，
只能声称“手工配置入口已实现”，不能声称“真实 gateway 已兼容”或“设备已配对”。
