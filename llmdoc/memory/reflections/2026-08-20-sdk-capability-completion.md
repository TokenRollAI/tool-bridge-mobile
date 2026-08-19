# 2026-08-20 SDK 能力补全与全局确认反思

## 背景

Android 真机已能建立前台 SDK session，但远程调用暴露出三个不同层面的问题：React Native 运行时与
SDK WebSocket 依赖的 Web API 并不完全等价；能力注册没有完整描述输出契约；本地确认只出现在首页
下方，导致用户停留在其他标签页或未滚动到对应区域时看不到裁决入口。

## 稳定经验

### 1. SDK 可打包不等于目标运行时 Web API 完整

PartySocket 会构造 `MessageEvent`，部分命令路径会调用 `AbortSignal.throwIfAborted()`；目标 React Native
运行时缺少这些成员时，连接仍可能 ready，但调用在设备端以泛化 `internal` 失败。兼容层应在 App 入口、
SDK 初始化前安装，并保持最小语义：只补缺失成员，不替换已有平台实现，也不复制 SDK 状态机。

### 2. expose 是双向契约，不只是输入 schema

每个公开 capability 必须同时声明 strict input 和 output schema；handler 结果在返回 SDK 前也要通过
output schema 解析。静态配置缺失的能力不应继续以“调用后 unavailable”方式暴露。为了覆盖网关上一次
注册，registry 仍发送已知 node path，但把 `cmds` 置空；网关是否正确删除旧命令属于真实兼容矩阵，不能
由本地单测外推。

### 3. 远程确认必须独立于页面与滚动位置

等待本地确认是全局安全阻塞状态，不能归属于首页某张卡片。确认 UI 应挂在 root runtime provider 下，
以 modal 覆盖所有 tab，只处理队列中最早一项，并显示调用方、能力、风险/effect、截止时间和 capability
显式挑选的详情。参数正文仍不能进入公告或普通日志。

### 4. 只暴露 SDK 当前确实提供的身份与控制能力

SDK 0.11 的 call 没有具体 Agent identity，因此 `runtime.pending_commands` 与 `runtime.cancel` 只能按
gateway credential principal 隔离；结果必须显式返回该 identity scope。取消只是对当前进程内、同 principal
活动命令发出 AbortSignal，不能冒充网关 mailbox 或跨设备撤销。

### 5. 本地 attention sound 应有固定、有限、可停止的数据源

find-device sound 可由固定参数生成短 PCM WAV，只写 App 私有 cache 并交给 `expo-audio`；不接收远端
音频、不请求录音权限，也不绕过静音/DND。声音与 haptic 分别 probe、分别启动和停止；flash 未实现时
继续返回 unavailable，不能因为 ring 其余通道可用而虚报。

## 证据与边界

- `pnpm verify`：59 suites / 248 tests，全量文档、配置、SDK entry、secret、typecheck、lint 与 Jest 通过。
- Android Preview production bundle 已成功构建；本轮发布收尾时 ADB 设备已断开，因此没有把再次安装
  最新 bundle 写成新增真机证据。用户另外确认已完成本地检查。
- 已有真实 Gateway 前台 session 与 runtime read 证据，但静态空 `cmds` 是否会清除 Gateway 0.9 的旧注册、
  iOS 构建和双端 sound/确认行为仍不能由本地自动化结论替代。

## 已提升的稳定知识

- 更新本地 command runtime：活动命令投影、同 principal 取消和 root modal 确认。
- 更新 capability slices：output schema、静态隐藏、runtime tools、media seek 与本地 attention sound。
- 更新 SDK transport 与 accessibility 参考：React Native 兼容层、空命令注册及全局 modal 语义。
