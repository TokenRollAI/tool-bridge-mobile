# 有界媒体解析反思

## 任务

关闭 `phone/media.play` 仅校验初始 HTTPS hostname、随后把远端 URL 直接交给 player 的安全缺口，使
重定向、内容类型、体积、取消和缓存生命周期都在本地可裁决。

## 预期与实际

表面上需要补 MIME 和大小检查；实际必须先把网络读取所有权从 player 收回 resolver。否则 native player
可能自行跟随 redirect、携带环境凭据、忽略 command 取消，且 App 无法在播放前知道最终 URL、实际字节
或内容签名。

## 暴露的问题

- 初始 URL 通过 allowlist 不代表 redirect target 或 fetch 暗中跟随后的最终 URL仍可信。
- `Content-Type` 和 `Content-Length` 都由远端声明；只做 header 检查不能阻止伪装 HTML 或 chunked
  超限响应。
- 只在下载器 `finally` 删除文件会过早删除成功 source；只在 stop 删除又会遗留下载/启动阶段 partial。
- timeout 与 command `AbortSignal` 是不同来源，必须收敛到同一个内部 abort，再保留稳定错误语义。
- 把 HTTPS URL 继续交给 player 会形成第二条未受 resolver 约束的网络路径，即使第一次预检完全正确。

## 实现结果

- `expo/fetch` 固定 `credentials: omit`、`redirect: manual`，逐跳和最终 response URL 都重用同一 HTTPS
  hostname allowlist，redirect 最多 3 次。
- 音频 MIME allowlist 与最多 16 字节 magic signature 双重检查；声明长度和流式累计字节均限制 25 MiB。
- resolver 有 30 秒本地 timeout 并传播取消；下载/校验失败进入 partial 删除路径，成功文件由幂等
  `release()` 交给 controller 管理。
- `expo-file-system` 只写 App 私有 cache，失败/取消/停止均进入清理路径；player 的 production 输入改为
  resolver 产出的 `file://` URI。
- 后续复核发现字节上限不能替代播放时长边界；原生 port 现先加载 metadata，并在任何 `play()` 前
  拒绝直播、无效时长和超过 2 小时的媒体，metadata 等待最多 10 秒且可取消。

## 证据边界

锁定 Node 22.23.1/pnpm 11.21.0 的 frozen install 与 `pnpm verify` 已通过，共 27 suites / 98 tests；
dependency audit 仍是 1 个 moderate 与 2 个带定向补丁/恶意样本回归后豁免的 high。局部实现不能外推
为 `objectRef`、远端 revoke、iOS 构建或双端真机媒体已完成。

## 已提升的稳定知识

- `must/safety-boundaries.md` 增加远端媒体进入 player 前的完整内容边界和清理要求。
- `architecture/capability-slices.md` 更新当前 media 纵向切片的数据流。
- `reference/bounded-media-source.md` 固化解析顺序、格式列表、生命周期所有权和声明上限。

## 后续

- 上游 `objectRef` 可用后，应新增独立 resolver/授权 adapter，不把 HTTPS hostname allowlist 冒充对象权限。
- 全量验证、原生构建和双端真机完成后分别更新 verified-state；其中任一项不能替代其他证据层。
- 如果未来允许更大文件、更多格式或跨域 redirect，必须同步更新 descriptor limits、安全测试和本文，
  不得只放宽 player 输入。
