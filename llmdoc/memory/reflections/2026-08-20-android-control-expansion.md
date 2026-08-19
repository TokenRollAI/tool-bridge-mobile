# Android 控制能力扩展调研反思

## 任务

核实现有移动端为何显得“权限严格、功能少”，评估 Android 高覆盖控制的可行路径，并把移动端无法独立解决的
协议缺口反馈给上游。本轮是调查与方案设计，没有实现新的设备能力，也没有改变当前产品安全边界。

## 已确认事实

- 生产组装入口实际注册 **20 个** command：`1 status + 2 attention + 6 media + 2 apps + 2 location +
  4 productivity + 3 runtime`。其中部分 command 会因构建 allowlist 为空而不进入 SDK expose；“已注册”、
  “已暴露”和“当前可用”是三个不同口径。
- 当前确认偏多主要来自默认 `ask_every_time`：所有非 read effect 都会确认，连 stop、pause、cancel 等低风险
  保护性写操作也不例外。`trusted_session` 虽已存在于类型、存储和 policy，却没有 UI 入口，而且只是无期限、
  无 capability/principal 范围的全局字符串，不能直接当成安全的可信授权产品。
- 本地确认策略与后台控制是两层机制。`SdkDeviceTransport` 在 App 非 active 时 suspend，多项 capability probe
  也先返回 `foreground_required`；因此即使减少确认，也不会获得后台送达、锁屏执行或进程被杀后的控制。
- 上游源码核验到具体契约链路：`CallFrame` 只有 `id/path/tool/arguments`，网关 invoke 路径虽持有鉴权后的
  `CallContext`，转发到 device 时没有携带，SDK handler 也只暴露这些字段和本地 `signal`。移动端因此只能用
  credential `keyId` 作粗粒度 principal，并生成本地固定期限。这个已认证 Gateway Credential 实例就是本地
  trusted authorization 的主体；缺少具体 Agent provenance 会限制审计归因和诊断，但不是本地授权的前置阻塞。
- 普通 Android App 即使启用 AccessibilityService，也不能承诺字面上的“完整控制”；锁屏、biometric、
  secure window、系统权限页和缺少 accessibility tree 的 UI 仍受平台限制。device owner 又需要独立 provisioning，
  不是普通安装后可提升的权限。
- 已向上游创建 [TokenRollAI/tool-bridge#68](https://github.com/TokenRollAI/tool-bridge/issues/68)，集中提出
  authenticated caller/deadline、动态 capability profile、mailbox + opaque push 和 command-bound
  protected `objectRef` 四组可验收需求；issue 明确不引入 raw shell 或通用 UI 自动化。

## 错误假设与纠正

### 1. 手工把能力数成 18 个

早期汇总误写为 18。纠正方式不是继续凭目录或文档目测，而是从
`ApplicationRuntime.#initializeOnce` 的生产注册顺序逐项列出，再与 registry 的 expose 规则交叉核对，最终得到
20。以后统计能力应同时报告 `registered / exposed / live available` 口径，避免配置隐藏项造成再次误数。

### 2. 一度把“放宽确认”近似成“获得后台控制”

这混淆了四个独立控制面：本地 policy 授权、capability live probe、transport 可达性和 Android 平台权限。
可信 grant 只改善第一层；后台命令还需要上游 mailbox/push、原生生命周期接入和平台允许的执行条件。
后续方案和 DOD 应分别列出这四层，不能用任一层的通过替代其他层。

### 3. 容易把目标词“完整控制”直接映射为一个高权限开关

代码与平台证据表明，需求至少应拆成类型化设备 API、跨 App observe/act、后台送达和专用设备管理四类。
当前仓库明确禁止任意第三方 App UI 自动化；若进入 AccessibilityService 路线，必须先作为独立 Android
product profile 和分发决策获得确认，而不是把提案暗写成当前实现或已决定架构。

### 4. 误把具体 Agent provenance 当成本地 trusted authorization 的前置条件

早期结论把 credential `keyId` 的粗粒度归因描述成“无法安全实现 per-Agent trusted grant”，隐含了授权必须
绑定具体 Agent 的错误前提。用户校正后，授权主体应明确为已认证 Gateway Credential 实例：本地 grant 需要
绑定 gateway `audience + credential identity + credential generation`，并在 credential clear、replace、rotate
或 revoke 时立即失效。具体 Agent provenance 可以作为上游可选字段改善审计、诊断和活动展示，但不能成为
移动端签发或匹配 trusted grant 的授权依据，也不应阻塞该能力落地。

## 验证过程教训

第一次运行验证使用了系统 Node `v26.7.0`，超出 `package.json` 锁定的 `22.23.1`，`verify:secrets` 的
`git ls-files` 子进程出现 `maxBuffer` 失败。这个结果既不证明发现了 secret，也不足以证明扫描脚本本身有缺陷。
切换为 `mise exec node@22.23.1 -- pnpm verify` 后全绿。

可复用顺序是：先核对 `engines.node`、`packageManager` 与实际版本，再解释验证失败；工具链不匹配时保留原始
失败信息，但应在锁定环境中复现后才归因。可考虑后续让验证入口 fail fast 报出 Node 版本不符，并为
`verify-secrets` 的 subprocess 显式设置合理 `maxBuffer`；两项都只是改进提案，本轮未实施。

## 方案边界（均为提案、未实现）

- 先用 capability-scoped、time-boxed 的本机 trusted grant 取代全局永久 `trusted_session`；grant 绑定
  gateway audience 与 credential identity/generation，并在 clear/replace/rotate/revoke 时失效。同时让
  stop/cancel/pause 等保护性动作减少无意义确认。
- 优先扩展 torch、volume、allowlisted app launch、compose/dial、SAF、sensor、可见 camera 等类型化 Android
  能力，继续拒绝 `execute(intent | selector | shell)` 一类通用逃生口。
- 只有用户明确选择跨 App 控制时，再设计独立 `android_personal_control` sideload/internal profile，分别请求
  Accessibility、MediaProjection、notification access，并以 package/action allowlist、TTL、可见会话和
  emergency disable 约束。
- 真正无人值守的 fleet/kiosk 场景另立 device-owner profile，不能与个人手机 consumer artifact、credential
  或能力目录混用。

## 可提升的稳定知识

- 能力盘点应从生产组装入口生成事实表，并区分 registered、exposed、available。
- 权限体验分析应固定拆成 policy、probe、reachability、platform privilege 四层。
- 本地 trusted authorization 应锚定已认证 Gateway Credential 的 audience、identity 与 generation 生命周期；
  Agent provenance 只作为可选审计/诊断信息，不作为授权前置。
- 上游阻塞结论应追到 core frame、gateway forwarding 和 SDK public handler 三段源码，而不只读下游文档。
- 验证归因前先回到仓库锁定工具链；unsupported runtime 的失败不能直接写成项目回归。
- 未经产品决策的 Accessibility/device-owner 方案只留在调查与 reflection，不提升为稳定架构现状。

本轮仅记录这些提升候选，未修改 stable docs 或 `llmdoc/index.md`。
