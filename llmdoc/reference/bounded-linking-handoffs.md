# 有界 Linking handoff 参考

## 范围

本文记录 `phone/location.open_map` 和 `phone/apps.can_open_url|open_url` 共享的异步 Linking 安全边界。
它描述的是把目标交给系统处理器，不是第三方 App 内动作、地图显示或导航完成的证明。

## `open_map` 输入与平台目标

`open_map` 使用 strict discriminated union，不接受未知字段：

- `purpose`：1–120 个安全显示字符。
- `coordinate`：latitude `[-90, 90]`、longitude `[-180, 180]`，可选安全 label 和 zoom `[2, 21]`。
- `query`：1–200 个安全显示字符。

安全显示字符拒绝 control 与 bidi override/isolate。caller 不能传 URL、scheme 或 provider；平台 builder
只从上述结构生成：

- Android：`geo:` URI，provider 摘要为 `android_geo_handler`。
- iOS：`https://maps.apple.com/` link，provider 摘要为 `apple_map_link`。

因此远端输入不能选择自定义 scheme、任意 host 或指定第三方地图 App。

## 共享 bounded probe

`boundedCanOpen` 同时受三个边界约束：

1. 调用方/运行时 `AbortSignal`；
2. command `expiresAt`；
3. 最长 5 秒的本地 Linking probe timeout。

开始前已取消返回 `cancelled`，已到期返回 `expired`。等待期间以 command 剩余时间和 5 秒中的较早者
为准：command deadline 先到仍返回 `expired`，否则本地上限返回可重试的 `linking_probe_timeout`。
late `canOpenURL` resolution 由 settle guard 忽略。

`open_map` 与通用 `open_url` 在 bounded probe 成功后、调用 `Linking.openURL` 前执行最后一次
`assertHandoffMayStart`。这关闭了“等待 `canOpenURL` 时 command 已取消/到期，但随后仍打开系统 App”的
handler 内 TOCTOU。`can_open_url` 是只读检查，也服从相同的取消、到期和本地 timeout。

## capability 与隐私语义

`open_map` 为 medium risk、`confirmation: always`、foreground only：

- capability probe 要求受支持平台、Linking module 和实际可处理本地生成安全目标的 handler；
- 执行时再次做 bounded `canOpenURL`，不能沿用较早 capability snapshot；
- 本地确认显示 purpose、结构化目标摘要和 provider，批准前不会执行 handoff；
- 成功 result 只含 `status: handed_off` 与 provider，不含 coordinate、query 或生成 URI；
- 普通 audit 只记录 command/capability/decision/outcome 元数据，不保存目标。

通用 `phone/apps` 仍只接受配置 allowlist 内的 HTTPS URL。它的脱敏结果可以包含 hostname，但
`handed_off` 同样只表示操作系统接受请求，不表示第三方 App 完成目标动作。

## Android package visibility

Android merged manifest 为地图 handler discovery 增加 `<queries>` 中的 `VIEW` + `geo:`，没有为
`open_map` 增加位置或后台权限。该 query 只允许 `canOpenURL` 发现匹配 handler，不授予打开能力，也不
证明 emulator/真机存在可用 provider。

## 证据边界

- unit 与 local runtime contract 覆盖 schema/builder、confirmation、probe、取消/到期 zero-open、脱敏和
  重复 `commandId` 单次 handoff；它们使用注入 adapter，不是 OS/第三方 App E2E。
- Android clean build 证明 package visibility query 可合并；API 36 emulator smoke 只断言能力页可发现
  `open_map`，没有实际调用 `Linking.openURL`。
- iOS 没有 simulator build，Android/iOS 都没有真机 handoff 证据；不能声称 provider 选择、地图显示、
  导航结果或后台/锁屏行为已验收。
- production transport、mailbox/revoke 与 `open_map` 本地 handler 是不同层，仍受上游阻塞。

## 事实真源

- `src/capabilities/location/openMapSchema.ts`：strict coordinate/query 与显示文本边界。
- `src/capabilities/location/mapTargetBuilder.ts` (`buildMapTarget`)：平台 URI 与 provider 摘要。
- `src/capabilities/location/openMapController.ts` (`OpenMapController`)：实际 handler probe、commit 与脱敏结果。
- `src/capabilities/location/openMapCapability.ts`：descriptor、confirmation、limits 与 invocation deadline。
- `src/capabilities/apps/boundedLinkingProbe.ts` (`boundedCanOpen`)：取消、deadline、5 秒 timeout 和 commit 复检。
- `src/capabilities/apps/controller.ts` (`AppHandoffController`)：通用 HTTPS handoff 的共享 bounded 边界。
