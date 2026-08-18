# 路线图

路线图按可验收的纵向切片组织，不按“先把所有页面画完”组织。阶段日期在团队排期后确定。

## P0：仓库与协议地基

目标：任何能力实现前，先建立可安全演进的移动运行时骨架。

### 工作项

- [x] 建立独立仓库、产品与架构文档；
- [ ] 初始化 Expo TypeScript development-build 工程；
- [ ] 配置 Android applicationId、iOS bundle id 和三环境；
- [ ] 建立严格 TypeScript、lint、test、CI；
- [ ] 建立 app/service/storage/native module 目录；
- [ ] 接入上游公共 `@tool-bridge/device-client`；
- [ ] pairing UI + SecureStore；
- [ ] SQLite command/audit schema 和 migration；
- [ ] 前台 WebSocket ticket 连接；
- [ ] capability registry 与 policy engine；
- [ ] 权限/能力页、活动页、紧急停用；
- [ ] fake gateway 和协议 fixture；
- [ ] 双端 debug build。

### 出口

Android/iOS 真机可配对、显示设备状态、前台注册 `phone/status.get`，撤销后立即失效；没有
硬编码 SK，没有复制上游协议源码。

## P1-A：找手机 golden slice

目标：第一个真正让 Agent 的手触达物理设备的闭环。

### 工作项

- [ ] `phone/attention.ring/stop` schema 与 capability；
- [ ] Android sound/vibration/flash adapter；
- [ ] iOS sound/haptic/notification adapter；
- [ ] 本地停止 UI；
- [ ] session TTL、限流、幂等；
- [ ] DND/静音/权限降级结果；
- [ ] mailbox + APNs/FCM push；
- [ ] queued/delivered/running/final 状态；
- [ ] 锁屏、后台、杀进程、弱网真机测试；
- [ ] Agent/CLI golden scenario。

### 出口

前台和后台可达场景都能得到真实状态；系统不允许的通道明确降级；重复 commandId 不产生第二次
响铃；用户随时可停止。

## P1-B：媒体与内容交接

目标：让 Agent 把内容可靠送到手机。

### 工作项

- [ ] App 自有播放器；
- [ ] media session / lock screen controls；
- [ ] `play/pause/resume/stop/status`；
- [ ] HTTPS/objectRef source policy；
- [ ] `open_url/can_open_url` allowlist；
- [ ] `open_map`；
- [ ] 通知 deep link；
- [ ] 后台播放、耳机控制、音频中断测试。

### 出口

Agent 能播放一段允许的媒体并控制本 App 会话；第三方 App 只返回 handed_off，不假成功。

## P1-C：相机协作

目标：把手机变成用户掌控的 Agent 视觉输入。

### 工作项

- [ ] object upload 上游能力；
- [ ] 相机权限教育与请求；
- [ ] 可见预览、purpose 和本地确认；
- [ ] 拍照、压缩、EXIF 策略；
- [ ] sha256 和单次上传；
- [ ] objectRef result；
- [ ] 取消、过期、上传失败和 crash cleanup；
- [ ] 前后台/锁屏/权限撤销真机测试。

### 出口

远程请求绝不会在后台静默拍照；用户确认后 Agent 获得有限期 objectRef；媒体不进入协议日志。

## P1-D：位置与本地辅助

目标：完成 MVP 能力集合。

### 工作项

- [ ] `location.current`；
- [ ] `productivity.notify`；
- [ ] App 内 timer；
- [ ] 动态 capability change 上报；
- [ ] 完整活动/审计页；
- [ ] accessibility、国际化和隐私文案；
- [ ] 商店合规材料；
- [ ] beta 测试与 staged rollout。

## P2：更长的手，但不降低安全

候选：

- QR/条码本地扫描；
- 用户确认的短视频和实时 WebRTC；
- 地理围栏；
- 系统 compose message / dial handoff；
- 传感器短时采样；
- 可签名的组织 policy profile；
- 多网关/多 Agent 的细粒度授权；
- 设备事件订阅；
- Wear OS / watchOS 配套入口。

每项能力进入实现前都要新增：

- 产品用例；
- 平台矩阵；
- 权限与商店评审；
- abuse case；
- 独立 DOD。

## P3：设备网络

长期方向：

- 手机作为附近设备发现和人机确认枢纽；
- Agent 在浏览器、手机、桌面间选择最合适执行端；
- 设备间安全 handoff；
- 实时空间/视觉协作；
- 组织设备 fleet profile。

这不是把所有设备变成 root shell，而是建立可发现、最小授权、平台诚实的现实世界工具网络。

## 优先级规则

出现需求冲突时按以下顺序：

1. 用户安全与平台政策；
2. 身份、权限、幂等和审计；
3. 端到端场景可完成；
4. 双端语义一致；
5. 能力数量；
6. UI 装饰和 Dashboard。

一个安全、可解释的 `ring` 闭环，优先于十个只在演示环境“看起来能调”的硬件 API。
