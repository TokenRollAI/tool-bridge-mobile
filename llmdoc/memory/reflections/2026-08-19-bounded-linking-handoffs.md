# 有界 Linking handoff 反思

## 任务

实现 `phone/location.open_map`，同时审计通用 `phone/apps` handoff 在 `canOpenURL` 等待期间的取消与到期
语义，确保结构化地图目标不会演变成 caller-controlled URI 或无界系统调用。

## 错误假设

容易把 `canOpenURL` 当成无副作用的瞬时布尔读取，认为 executor 在 handler 前已经检查取消/到期就足够。
实际它是可能挂起的 native Promise；handler 进入后 command 仍可能在等待期间取消或到期，若直接继续
`openURL` 就会越过最后安全边界。

另一个危险捷径是让 caller 直接传 `geo:`、Apple Maps URL 或 provider。即使 schema 限制字符串长度，
也会把 scheme、host、编码和 provider 选择权交给远端，扩大注入与平台差异面。

## 实现结果

- `open_map` 只接收 strict coordinate/query/purpose，由本地 builder 生成 Android `geo:` 或 Apple Maps
  HTTPS，不接受 caller URL、scheme 或 provider。
- `open_map` 固定 always confirmation 和 foreground，并用实际 handler probe，而不是仅凭 OS 名称声明可用。
- 抽取共享 `boundedCanOpen`：服从 `AbortSignal`、command `expiresAt` 与 5 秒本地 timeout，并忽略 late
  resolution；`open_map` 和 generic apps handoff 都在 `openURL` commit 前复检。
- 地图结果只返回 `handed_off + provider`，普通 audit 不含目标；系统接受 handoff 不等于地图或导航成功。

## 证据层经验

- manifest 的 `VIEW` + `geo:` query 只解决 Android package visibility，不等于设备有地图 handler。
- capability 页面出现 `open_map` 只证明最新 JS/registry/probe 投影能加载；本轮 emulator smoke 未实际
  handoff。
- 注入式 zero-open、脱敏和 100 次重复 command 测试证明本地状态机，不证明 Android/iOS 真机 provider
  行为。
- 当前全量基线为 32 suites / 118 tests，Android clean build 与 emulator smoke 已完成；iOS 构建、双端
  真机 handoff 和 production transport revoke 仍未完成。

## 已提升的稳定知识

- `must/safety-boundaries.md` 增加异步 Linking 与结构化地图目标不变量。
- `architecture/capability-slices.md` 记录 `open_map` 与 generic apps 的共享 bounded handoff 流。
- `reference/bounded-linking-handoffs.md` 固化 schema、平台 builder、deadline/timeout、commit 与证据边界。

## 后续

- 真机验收必须分别证明 Android/iOS handler 可用、确认后实际 handoff、取消/到期不打开，以及结果仍只
  表示 `handed_off`。
- 如果未来增加第三方 provider 选择，必须新增受控 enum/adapter 与逐平台 probe，不能开放 caller URI。
- production transport/revoke 可用后需补端到端取消竞态；本地 bounded Linking 不能替代远端撤销证据。
