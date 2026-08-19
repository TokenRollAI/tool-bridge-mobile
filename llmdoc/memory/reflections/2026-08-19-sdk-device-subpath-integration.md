# React Native SDK 子入口接入反思

## 任务

在上游发布 `@tool-bridge/sdk@0.11.0` 后，复核其 React Native 契约并把官方 device transport 接入现有
移动端本地安全执行器，同时更新此前“U-1 未交付”的项目知识。

## 最初假设与实际

此前根据 0.10.1 的包根入口、`engines.node` 和 `ws` 依赖判断 SDK 不能进入 React Native。0.11.0
没有改变包根的 Node 定位，而是新增独立 `/device` export。只看 package 级 engines/dependencies 仍会
得出错误结论；真正需要验证的是 export condition、对应产物的静态 import 图和 Metro 的实际解析结果。

另一个容易过度外推的点是“device client 已交付”不等于“移动协议所需元数据都已交付”。0.11.0 的
call handler 没有具体 caller、createdAt 或 expiresAt。移动端可以安全接入 transport，但必须明确压缩为
gateway principal，并给本地 handler 生成更短的 commit deadline，不能伪造 Agent attribution。

## 有效做法

- 同时核对 npm registry tarball、package exports、上游源码/README/测试和本地 lock integrity；
- 只导入 `@tool-bridge/sdk/device`，再用脚本锁住该产物只有 `partysocket/ws` 外部 import，拒绝 Node
  `ws/process.env` 漂移；
- 用真实 SDK supervisor + fake raw WebSocket 验证 Authorization header、hello/ready/call/result 和
  AppState suspend，而不是在移动仓库复制 frame 状态机；
- 保留 SDK call id 进入 SQLite command repository，让 SDK 内存 cache 只是第一层优化，不成为副作用
  防重放真源；
- 把 credential audience、缺失、拒绝与 UI state 做 fail-closed 映射，只有 ready 才显示 online；
- 新发布版本若必须绕过 release-age 等待期，只对精确版本加例外，并把 tarball、license、Metro 和
  consumer contract 证据写在相邻注释与文档中。

## 暴露的剩余缺口

- pairing 尚无生产入口，fresh install 无法自行获得 SecureStore device credential；
- 现有 RN header 能连接既有 SK，但不是 U-3 短期 ticket；
- call 缺具体 Agent caller 与 gateway deadline，Activity 当前只能归因到 credential keyId/gateway；
- fake WebSocket consumer contract 不是实际 gateway compatibility matrix；
- 双端 Metro 只证明可 bundle，不证明真机握手 header、弱网、后台或长期稳定性。

## 提升到稳定知识

- 新增 `reference/sdk-device-transport.md` 固化版本、入口、生命周期、凭证和 call 适配边界；
- 更新 upstream blocker reference，把 U-1 标为已交付，U-2 至 U-7 与 caller/deadline 继续列为缺口；
- 更新 evidence language，新增“SDK consumer 已集成”与“真实 gateway 已兼容”的证据分层。
