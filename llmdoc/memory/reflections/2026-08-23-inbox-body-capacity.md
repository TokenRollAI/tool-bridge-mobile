# 信箱长正文容量调整反思

## 任务

用户反馈 `phone/inbox.deliver` 的 4,000 字符正文上限无法容纳 Agent 整理的新闻长文，希望取消限制或显著
提高容量。本次把本地 strict schema 的单条 Markdown 正文上限提高到 64,000 字符，并同步 Agent 可发现的
JSON Schema、公开能力文档与本地契约测试。

## 关键经验

### 1. 内容容量必须沿“发现 → 裁决 → 存储”验证

4,000 字符限制只直接出现在 `src/inbox/schema.ts`，SQLite `TEXT` 列和 repository 没有独立的 4,000 字符
约束。但只改 schema 常量仍不足以证明 Agent 真能使用新容量：device expose 会把 Zod schema 转为 JSON
Schema，调用到达后还会再次经过 registry/runtime parse，最终才写入专用信箱表。

因此容量变更需要同时证明：

- 本地 schema 接受 64,000、拒绝 64,001；
- `z.toJSONSchema` 对 `body` 暴露 `maxLength: 64000`，Agent 不会继续按旧限制规划输入；
- local runtime contract 能把 64,000 字符正文写入 `inbox_messages`，超限输入在副作用前返回
  `invalid_argument`。

“数据库能存”不能代替发现层和运行时层证据，“schema 能 parse”也不能代替真实存储路径证据。

### 2. 移动端内容域不应改成完全无界

正文会参与 JSON frame 解析、Zod 校验、SQLite 存储、全文搜索和 Markdown 渲染。完全删除上限会让单次远端
输入拥有无界内存、存储和布局成本，也会把 1,000 条 retention cap 放大成不可控的最坏存储规模。

64,000 字符是本次产品取舍：相对旧值提高 16 倍，可覆盖常见新闻汇总与长篇 Markdown，同时继续保留单条
资源边界。现有 Markdown token 上限、一次只展开一条、图片数量/字节限制和 1,000 条 retention 仍独立生效；
提高正文字符上限不应绕过这些边界。

### 3. 本地通过不等于真实 Gateway 已接受长 frame

当前 `pnpm verify` 能证明本地 schema、device expose 形状、executor、repository 与 UI 相关自动化继续通过。
本机安装的 `@tool-bridge/sdk/device@0.14.1` 产物中未发现额外的 client-side message 大小裁剪，但本次没有
执行真实 Gateway 的 64,000 字符 `inbox/deliver` call，也没有双端真机测量长正文的内存、搜索或布局行为。

因此只能声称本地能力上限已经提高并由自动化覆盖；真实 Gateway frame、Android/iOS 真机性能与体验仍需
独立验证。

## 提升候选

- 信箱稳定 reference 应把正文上限固定为 64,000，并把 schema、expose maxLength 与 runtime 落盘列为同一
  容量契约。
- 后续改变公开 schema 上限时，应同步 PRD、能力目录、SDK、DOD、安全/架构文档与 llmdoc reference，避免
  Agent 发现信息、实现和产品说明出现漂移。
