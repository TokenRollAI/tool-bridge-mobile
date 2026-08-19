# 本地 trusted grant 绑定 Gateway Credential 实例

- 状态：已决定，未实现
- 日期：2026-08-20
- 范围：未来替代全局 `trusted_session` 的本地可信授权主体与失效边界

## 背景

当前 `trusted_session` 只是 SQLite `settings` 中的全局 control mode 字符串，没有生产 UI、TTL、
capability scope 或 credential-instance binding。当前 SDK call 也没有具体 Agent identity，移动端只把
credential `keyId` 投影为 gateway principal。

产品方向已经明确：用户信任的是与设备建立认证关系的 Gateway Credential，而不是经该 Gateway 发起调用的
某个具体 Agent。Agent provenance 的缺失会降低审计归因精度，但不应迫使本地授权变成 per-Agent grant。

## 决策

1. 未来 trusted grant 的授权主体是当前已认证 Gateway Credential 实例，不是 Agent identity。
2. grant binding 至少包含 `audienceOrigin`、gateway-issued credential identity 与 credential/key
   generation。持久化层只保存匹配所需的非秘密标识；credential secret/material 继续只进入系统安全存储。
3. credential clear、replace、rotate、revoke 或 audience 变化时，旧 grant 必须在 transport 恢复或任何
   新 command 放行前失效。新的 credential 实例不得继承旧 grant。
4. Agent identity 仅可作为上游提供的可选审计、诊断和 UI 展示元数据；它不得参与 trusted grant 的签发、
   查找、匹配、放行或失效，也不得由移动端从 arguments 自报值推断。
5. Gateway Credential 信任不覆盖设备本地裁决：系统权限、用户拒绝、live capability probe、前后台/锁屏
   条件、high-risk 逐次确认、deadline/cancel 和 emergency disable 继续优先。

## 尚未决定

- grant 的默认 TTL、可选时长、capability scope 表达和 UI 文案；
- 哪些 medium/low-risk 操作可进入 grant，哪些保护性 stop/cancel 操作改为无需确认；
- gateway-issued credential identity/generation 的最终 wire/schema 名称和持久化 schema；
- 手工 URL/API key 内测 fallback 是否允许进入单独的低保证信任模式。

客户端派生的 `manual_api_key_<uuid>` 当前不具备 gateway-issued generation，不能自行充当正式 binding
契约。以上未决定项不能用现有全局 `trusted_session` 预先实现。

## 上游最低依赖

本地 trusted grant 不要求具体 Agent provenance，但需要 invocation 能由 gateway-authenticated device
credential/session 绑定到可验证的 credential identity/generation，并携带 gateway 权威的 createdAt/
expiresAt/deadline。动态 capability profile、mailbox/push 和 `objectRef` 仍是独立上游工作。

## 结果

- 同一 Gateway Credential 下的多个 Agent 共享本地 grant；若需要 per-Agent 限制，应由 Gateway 权限体系
  承担，移动端不复制 Agent ACL。
- credential 生命周期成为本地授权生命周期的一部分，clear/replace/rotate/revoke 必须与 grant invalidation
  形成 fail-closed 顺序并留下可验证测试。
- Agent identity 可以改善 Activity attribution，但缺失时本地仍可基于 Gateway Credential 正确授权。
- 当前代码和上游 `@tool-bridge/sdk/device@0.11.0` 尚未实现该决策；不能声称 trusted grant 已可用。

## 相关文档

- `llmdoc/architecture/local-command-runtime.md`
- `llmdoc/reference/sdk-device-transport.md`
- `llmdoc/reference/manual-gateway-configuration.md`
- `llmdoc/reference/upstream-and-platform-blockers.md`
- `docs/adr/`：正式实现前应补充对应 ADR。
