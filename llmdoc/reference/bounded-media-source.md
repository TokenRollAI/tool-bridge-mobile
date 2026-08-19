# 受控 HTTPS 媒体源参考

## 范围

本文记录 `phone/media.play` 把不受信的远端 HTTPS 音频解析为 App 私有本地文件的稳定边界。它不描述
尚未实现的 `objectRef`，也不证明真机播放、后台、锁屏或音频中断行为。

## 解析顺序

```text
strict source schema
  -> HTTPS URL policy
  -> expo/fetch(credentials: omit, redirect: manual)
  -> 每个 redirect Location 重新执行同一 URL policy
  -> 最终 response URL 再执行同一 URL policy
  -> 2xx + body
  -> audio MIME allowlist
  -> Content-Length <= 25 MiB（存在时）
  -> 流式读取，实际累计字节 <= 25 MiB
  -> 前 16 字节内的格式 magic 与 MIME 匹配
  -> 关闭 App 私有 cache 文件
  -> 把 file:// URI 交给 expo-audio player
  -> 最多 10 秒等待 metadata
  -> play 前拒绝直播、无效时长或 duration > 2 小时
```

URL policy 要求标准 443 端口、无 userinfo、无 fragment、非 IP literal，且 hostname 精确出现在
`EXPO_PUBLIC_MEDIA_HOSTS` 解析出的 allowlist。resolver 最多跟随 3 次 redirect；跨 allowlist、缺失
`Location`、重定向过多或 fetch 实现意外落到其他最终 URL 都会在缓存/player 前拒绝。

## 内容边界

当前 MIME allowlist：

- `audio/aac`
- `audio/flac`
- `audio/mp4`
- `audio/mpeg`
- `audio/ogg`
- `audio/wav`
- `audio/webm`
- `audio/x-wav`

声明 MIME 不是充分条件。resolver 收集最前面的最多 16 字节并检查 AAC、FLAC、MP4、MPEG、Ogg、
RIFF/WAVE 或 WebM 对应 signature。`Content-Length` 缺失时仍可流式读取，但实际累计字节硬上限始终
生效；空 body、无效/零长度声明、MIME 不匹配或 signature 不匹配均返回稳定本地错误。

## 时限、取消与清理所有权

- resolver 自带 30 秒 local timeout，并把调用方 `AbortSignal` 转发给 fetch/stream。
- 超时、取消、HTTP/MIME/signature/字节校验失败或缓存写入失败时，进入取消 reader 和删除 partial cache
  的清理路径；清理错误不覆盖原始失败语义。
- 成功返回的 `ResolvedMediaSource` 持有幂等 `release()`；controller 在 stop、播放失败或 player 启动失败
  时调用它，保证本地文件生命周期覆盖整个 player 会话而不是只覆盖下载阶段。
- `ExpoMediaCacheStore` 使用 `Paths.cache/tool-bridge-media`；首次初始化会清理先前遗留项。
- production composition 中 `ExpoAudioPlaybackPort` 只接收 resolver 返回的 `file://` URI，不再自行请求
  原始 HTTPS URL。
- player metadata gate 最多等待 10 秒并监听同一个 `AbortSignal`；直播、无法得到正时长和超过 2 小时
  的媒体在调用原生 `play()` 前被拒绝，随后释放 player 与缓存。

## 声明边界

- hostname allowlist 是配置与域名信任边界；本实现不是通用浏览器下载器，也不授权任意域名或 IP。
- HTTPS source 仍是本地媒体输入路径，不等于 Tool Bridge 受保护对象。没有 `objectRef`、绑定
  command/device 的下载授权、对象 TTL 或上游权限检查。
- 本地 source/controller 测试只能证明解析、拒绝与清理状态机；完整测试总数、Android/iOS 构建和双端
  真机媒体行为必须分别记录，不能由本文推断。

## 事实真源

- `src/capabilities/media/sourcePolicy.ts` (`validateAllowedMediaSource`)：初始、redirect 与最终 URL policy。
- `src/capabilities/media/sourceResolver.ts` (`BoundedMediaSourceResolver`)：fetch、MIME/signature、大小、
  timeout、取消与 partial cleanup。
- `src/capabilities/media/expoMediaCacheStore.ts` (`ExpoMediaCacheStore`)：App 私有 cache 与文件释放。
- `src/capabilities/media/controller.ts` (`MediaSessionController`)：source/player 生命周期所有权。
- `src/capabilities/media/expoAudioPlaybackPort.ts` (`ExpoAudioPlaybackPort`)：本地 URI、播放前时长闸门与
  系统控制。
