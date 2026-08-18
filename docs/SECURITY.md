# 安全、隐私与平台约束

状态：实现必须遵守的安全基线。

## 1. 威胁模型

需要防御：

- pairing 二维码被截获或重复使用；
- 设备凭证从日志、URL、存储或崩溃报告泄漏；
- 合法 Agent 被授予超过任务需要的能力；
- 网关或客户端重试导致重复副作用；
- 恶意参数触发任意 URL、文件访问、超大上传或资源耗尽；
- push payload 泄漏任务内容；
- 设备丢失后原配对仍可远程操作；
- 能力目录显示安全，但执行时权限/前后台状态已变化；
- 远程调用伪装成系统提示诱导用户；
- 供应链依赖或 native module 越权读取数据。

不假设：

- 网关鉴权通过就代表用户同意当前动作；
- push 必达；
- WebSocket 常驻；
- 手机系统会允许 App 突破静音、锁屏或后台限制；
- 设备本地数据库永远不会被物理攻击者读取。

## 2. 信任边界

```text
Agent credential
      |
      v
Tool Bridge Gateway ---- APNs / FCM
      |                       |
      v                       v
Device credential ---- Mobile Runtime
                          |
                    Local Policy + User
                          |
                     Native Capability
```

- Agent credential 只证明调用方；
- device credential 只证明某个已配对设备；
- push provider 只传递提示，不承载授权；
- Local Policy + User 才决定是否在此时执行；
- Native Capability 必须再次依赖系统权限。

## 3. 凭证

### 3.1 设备凭证

- 每台安装实例独立；
- 限定 gateway audience、deviceId、mountPath 和设备操作；
- 不具备用户/管理员管理权限；
- 可撤销、可轮换；
- 通过 SecureStore 或更强的 Keychain / Keystore-backed native module 保存；
- 不进入 AsyncStorage、SQLite、剪贴板、deep link、push、analytics；
- UI 最多显示 keyId 和尾部指纹。

### 3.2 WebSocket ticket

- 单次使用；
- 短 TTL；
- 绑定 deviceId、session nonce 和 audience；
- 消费后不可重放；
- 服务端日志对 query 和 ticket 脱敏；
- ticket 不能用于 HTTP mailbox 或管理 API。

### 3.3 Push token

push token 是敏感设备标识：

- TLS 传输；
- 服务端加密/受控存储；
- 轮换时原子更新；
- provider 返回 invalid token 时失效；
- 撤销配对时删除；
- 不出现在普通日志或分析事件。

## 4. 授权层

一次调用必须连续通过：

1. Agent SK 的树路径权限；
2. 网关对设备/mountPath 的路由权限；
3. device credential 的连接与 mailbox 权限；
4. capability profile 声明；
5. 本地控制模式和工具策略；
6. 当前系统权限；
7. 前后台、锁屏、网络和硬件条件；
8. 需要时的本地用户确认。

任一层拒绝即不执行。下游层不能因为上游已允许而跳过。

## 5. 风险分级

| 等级 | 示例 | 默认策略 |
| --- | --- | --- |
| Low | 读取 App/连接状态、媒体状态 | 配对后可调用 |
| Medium | 本地通知、计时器、响铃、打开普通 HTTPS | Ask every time；trusted session 可配置 |
| High | 位置、相机、麦克风、通信深链 | 每次确认或前台明确交互 |
| Prohibited | 隐藏拍摄、任意 shell、绕锁屏、静默发送/拨号 | 不实现 |

`effect: read/write/destructive` 与风险等级是不同维度。读取精确位置虽然不写状态，仍是 high。

## 6. 用户确认

确认页至少展示：

- 谁在请求（调用方可验证名称/标识）；
- 请求哪项能力；
- 用途 `purpose`；
- 将收集/影响什么；
- 数据会发送到哪个网关；
- 结果有效期；
- 允许一次 / 拒绝；
- 对允许进入 trusted session 的能力，单独提供限时授权入口。

禁止：

- 模糊按钮如“继续”代替“拍摄并上传”；
- 在通知正文中模拟系统权限弹窗；
- 预选长期授权；
- 用户拒绝后自动循环弹出；
- 相机/麦克风确认与另一个无关操作捆绑。

## 7. 命令安全

- 所有 arguments 运行时 schema 校验，未知字段默认拒绝；
- commandId + 本地事务去重；
- 每条命令有 expiresAt；
- claim 和 result 都绑定 deviceId；
- 取消在开始副作用前必须生效；
- handler 有时长、次数和资源上限；
- URL、scheme、MIME、文件大小和媒体时长 allowlist；
- 错误对 Agent 返回稳定 code，不泄漏原生 stack；
- 网关时间与设备时间偏差要容忍，但不能无限延长过期命令。

## 8. 媒体与隐私数据

- 照片/音频/视频不进入普通日志、analytics 或 push；
- 默认移除照片 EXIF 位置；
- 临时文件放 App private storage；
- 上传 URL 单次、短期、限定大小与 MIME；
- 完成后校验 sha256；
- 对象引用受 Tool Bridge 权限保护并有 TTL；
- 用户能查看近期创建对象并提前删除；
- crash 后清理孤儿临时文件；
- debug build 也不能打印 base64、signed URL query 或精确位置。

## 9. 审计

记录：

- commandId；
- 时间；
- caller subject/key id 的非秘密标识；
- path/tool；
- effect/risk；
- policy decision；
- 用户确认/拒绝；
- 状态和结构化错误码；
- 客户端与协议版本。

默认不记录：

- 完整 arguments；
- SK/ticket/token；
- 照片/音频；
- 精确坐标；
- 联系人或消息正文；
- signed URL；
- 原生绝对文件路径。

审计保留有上限，用户可以清除；安全事件所需服务端审计与用户本地历史分开定义。

## 10. iOS 约束

### 后台

Apple 明确说明后台通知是低优先级、可能被节流且不保证送达；被唤醒后也只有有限执行时间。
因此：

- 不承诺离线命令即时执行；
- command 必须先进入 mailbox，push 只是提示；
- UI 区分 queued、push_sent、delivered；
- 用户强制退出 App 后，不承诺后台恢复；
- 找手机能力不能宣称等同系统级 Find My。

来源：[Apple：Pushing background updates to your App](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)。

### 相机与麦克风

- 系统要求用户明确授权并提供 usage description；
- App 进入后台时应释放相机等共享资源；
- 远程拍摄必须把用户带到可见前台流程；
- 不实现后台静默相机/麦克风。

来源：

- [Apple：Requesting authorization to capture and save media](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
- [Apple：Preparing your UI to run in the background](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background)

### 声音与注意力

- 遵守静音、专注模式、通知授权和系统音频会话；
- 不承诺强制突破 DND；
- 使用正常通知/音频能力，不能模拟系统级紧急警报权限。

## 11. Android 约束

### 后台启动与敏感权限

Android 对后台启动 foreground service 有限制；涉及 camera/microphone/location 的 while-in-use
权限时，后台启动尤其受限。因此：

- App 在后台收到相机命令时进入 `awaiting_user`；
- 通过可见通知让用户打开 Activity 后再访问相机/麦克风；
- foreground service 声明准确 service type 和可见通知；
- 捕获 SecurityException 并返回平台限制；
- 不利用豁免路径规避用户可见性。

来源：

- [Android：Restrictions on starting a foreground service from the background](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android：Foreground services and camera/microphone restrictions](https://developer.android.com/about/versions/11/privacy/foreground-services)

### 通知

- Android 13+ 请求 `POST_NOTIFICATIONS`；
- 在合适的产品语境申请，不在首次启动无解释弹窗；
- 找手机、后台播放等使用名称清晰的独立 notification channel；
- 用户关闭 channel 后 capability profile 必须反映降级。

来源：[Android：Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission)。

### 后台媒体

使用正规 MediaSession / foreground service 和可见媒体通知；停止播放后释放服务。

来源：[Android：Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)。

## 12. App Store / Play 合规

发布前必须：

- 权限声明与实际功能逐项对应；
- privacy policy 说明远程 Agent 调用、收集类型、保留和删除；
- 商店截图/UI 不暗示隐形监控；
- iOS Privacy Manifest 与 Android Data Safety 一致；
- 后台模式只声明实际需要的类型；
- 相机、位置、通知的 purpose string 清楚；
- 账号/配对撤销与数据删除路径可用；
- SDK 数据收集清单完成；
- 安全联系人和漏洞报告渠道存在。

## 13. 安全事件

发现凭证或远程控制风险时：

1. 服务端 capability kill switch；
2. 撤销受影响设备 key/ticket；
3. 停止签发相关命令；
4. 保留脱敏审计；
5. 发布修复版本；
6. 在 App 中提示重新配对/升级；
7. 完成根因和防复发测试。

kill switch 只会收紧能力，不能远程打开用户已关闭的权限。
