# 稳定 device 身份与挂载路径迁移反思

## 任务

用户报修“每次重连设备 ID 都不稳定”。调查根因后引入基于硬件标识的稳定 deviceId
（`src/identity/deviceIdentity.ts`），支持网关配置表单自定义 deviceId，并把挂载路径从上游默认
`device/<deviceId>` 迁移为客户端 hello 声明的 `mountPath: device/phone/<deviceId>`。

## 容易误判的信号

- 症状“每次都变”不等于“每次都随机生成”。代码里 deviceId 本来就是从 SecureStore 持久化
  installationId 派生的稳定 `mobile_<uuid>`，重连路径不会 mint 新 ID；真正的不稳定点是
  `installationIdentityStore.getOrCreate()` 在 SecureStore 读到 null 时静默生成新 UUID。
- 触发场景都在持久化根基被清空：重装/清数据（adb uninstall）、Android Auto Backup 排除
  SecureStore、Keystore 失效。排障时要先区分“生成逻辑不稳定”与“持久化根基会被清空”。
- 兜底逻辑从 `installation_<uuid>` 提取 hex 字符时，忘了 "installation" 前缀本身含字母 a，
  先写的实现把前缀字符混进结果；测试抓住后改为先剥前缀再过滤。fallback 的输入形态假设
  也要有测试期望值。

## 有效做法

- 默认 deviceId 由设备硬件标识（expo-application 的 Android ID / iOS IDFV）加域分隔盐
  SHA-256 截断为 12 位 hex，跨重装稳定；硬件不可用时回退 installationId 派生；digest 原生
  模块失败时再兜底直接取 installation UUID 字符，避免让整个 runtime 初始化失败。
- 用户可在网关配置表单自定义 deviceId，校验正则与上游网关 `assertDeviceId` 的 DO 路由
  约束对齐（`/^[A-Za-z0-9._-]{1,64}$/`），并把 `DeviceCredentialEnvelope` 的 deviceId schema
  同步收紧，本地 fail fast。
- 挂载路径迁移时，为避免树上出现 `device/phone/<id>/phone/attention` 的重复段，没有重命名
  15+ 处本地 capability descriptor path，而是在 wire 边界做对称转换：expose 时剥掉 `phone/`
  前缀，网关下发的相对 call path 进 executor 前补回。这保住了本地 `phone/*` 规范命名空间、
  SQLite 命令/审计历史格式与全部既有测试。当 wire 表示与本地规范命名冲突时，优先在
  adapter 边界做双向转换，而不是全仓重命名。

## 证据边界

- 手工 API key 是否对 `device/phone/*` 持 register scope 无法本地证明，需真实网关/真机验证；
  若无权限，hello 会被 permission_denied 拒绝（本地投影为 protocol_error）。
- 旧 credential envelope（`mobile_<uuid>`）仍兼容新 schema，但重新挂载后网关侧旧
  `device/mobile_<uuid>` 僵尸节点要等 24h reclaim 才消失，本地无法加速。

## 提升到稳定知识

- 候选：把“持久化身份的清空场景（重装/Backup 排除/Keystore 失效）”与“wire 边界双向路径
  转换”补进 `reference/manual-gateway-configuration.md` 与 `reference/sdk-device-transport.md`。
- 候选：`must/evidence-language.md` 路线的教训——register scope 与僵尸节点 reclaim 属于
  只能真机/真网关验证的未证明项，结论措辞不得声称已验证。
