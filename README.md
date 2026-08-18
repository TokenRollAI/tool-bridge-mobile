# tool-bridge-mobile

让 Agent 的能力边界从云端延伸到用户明确授权的手机。

`tool-bridge-mobile` 是 HTBP / Tool Bridge 生态中的移动设备运行时。它把 Android 和 iOS
设备上的状态、提醒、媒体、位置、相机等能力，以可发现、可授权、可审计的 Tool Bridge
节点暴露给 Agent。

> 当前状态：**规划与协议对齐阶段**。仓库暂不声称已有可运行 App；第一批代码必须从
> [DOD](docs/DOD.md) 中的 P0 闸门开始。

## 它解决什么问题

Agent 今天大多只能调用云端 API。这个项目让 Agent 在用户许可范围内继续完成现实世界任务：

- “帮我找手机”——让指定设备响铃、震动、闪灯，并返回是否已被用户找到；
- “在手机上放首歌”——控制本 App 的播放队列，或打开用户选择的音乐 App；
- “看看路由器指示灯”——请求用户确认后调用相机，拍一张照片并返回对象引用；
- “我到公司时提醒我提交报销”——创建本地提醒或地理围栏任务；
- “把这个地址在手机地图里打开”——通过受控深链交给系统应用。

它不是远程桌面、监控软件或 MDM。系统权限、用户确认和平台限制始终优先于 Agent 指令。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [PRD](docs/PRD.md) | 用户、场景、范围、需求和产品验收 |
| [能力目录](docs/CAPABILITIES.md) | 计划暴露的节点、工具、权限和阶段 |
| [系统架构](docs/ARCHITECTURE.md) | 组件、连接、唤醒、命令生命周期和媒体传输 |
| [SDK 使用](docs/SDK.md) | 当前 SDK 事实、移动端接入方式和上游缺口 |
| [技术选型](docs/TECH-STACK.md) | React Native / Expo 方案及取舍 |
| [安全与平台约束](docs/SECURITY.md) | 配对、授权、审计、iOS / Android 限制 |
| [上游依赖](docs/UPSTREAM.md) | Tool Bridge 与 HTBP 需要同步交付的能力 |
| [路线图](docs/ROADMAP.md) | P0 到 P3 的实现顺序 |
| [Definition of Done](docs/DOD.md) | 仓库、功能、版本与场景验收闸门 |
| [ADR](docs/adr/0001-react-native-expo.md) | 首个技术决策记录 |

## 仓库边界

这个仓库拥有：

- Android / iOS App；
- 设备运行时、权限与用户确认 UI；
- 移动端原生模块（Kotlin / Swift）；
- 本地队列、审计记录和凭证安全存储；
- 移动端集成、端到端测试和商店构建配置。

这个仓库不拥有：

- HTBP 通用协议定义：在 [TokenRollAI/HTBP](https://github.com/TokenRollAI/HTBP)；
- 网关、通用 SDK、设备命令邮箱和对象存储：在
  [TokenRollAI/tool-bridge](https://github.com/TokenRollAI/tool-bridge)；
- 浏览器扩展：后续单独放在 `tool-bridge-browser`。

## 开发原则

1. **能力可发现**：Agent 以运行时 `~help` / capability profile 为准，不猜平台能力。
2. **平台诚实**：不可用就返回结构化 unavailable，不伪装执行成功。
3. **最小权限**：权限按功能逐次申请，不在首次启动索取全部权限。
4. **敏感动作可见**：相机、麦克风、持续定位等必须有系统指示与本地确认。
5. **结果可审计**：每次远程调用都有调用方、能力、时间、决策和结果记录。
6. **大对象走引用**：照片、音频和视频不上塞 HTBP JSON 帧。

## 当前验证

仓库在文档阶段提供轻量验证：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

进入 P0 代码阶段后，`pnpm verify` 必须扩展为 typecheck、lint、unit test 和协议契约测试；
原生构建及真机测试要求见 [DOD](docs/DOD.md)。

## License

MIT
