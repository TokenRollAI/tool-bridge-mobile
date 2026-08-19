# Accessibility semantics 自动化基线

## 共享语义

- `Screen` 暴露唯一页面 header，并只在页面获得 focus 时请求辅助技术焦点；普通 snapshot/rerender 不
  反复抢焦点。`StatusCard` title 是 header，`StatusRow` 将 label/value 合成单一可访问名称并隐藏重复的
  视觉子文本，同时允许系统字号和换行。
- `AccessibleAction` 统一 button role、上下文唯一 label、必要 hint、busy/disabled state，以及至少
  48dp 的 minWidth/minHeight。四个 tab 显式使用“状态/能力/媒体/活动标签页”唯一 label，并投影 selected。
- Activity destructive confirmation 打开时聚焦确认标题，取消/完成后返回清除触发按钮；组件测试覆盖
  focus 往返和普通更新不抢焦点。
- 远程 command 的 `PendingConfirmationModal` 挂在 root layout，不受当前 tab 与首页滚动位置影响；打开时
  聚焦标题，只显示最早一项，并为“允许一次/拒绝”提供包含 caller 与 capability 的唯一名称。

## 公告与敏感边界

- `useDiscreteAccessibilityAnnouncement` 用 semantic key 去重：初始 render 不公告、相同 key 不重复，
  只在错误、控制模式、pending 数量、timer/media 等离散状态变化时发出安全摘要。
- confirmation detail、message、purpose、地址、坐标、URL 和完整 outcome 不进入 accessibility
  announcement；全局 confirmation 只公告待处理数量。detail 可作为用户主动查看的 modal 视觉/语义内容，
  但 action label 只包含 caller 与 capability。attention 倒计时和媒体 progress 只视觉更新，不改变
  semantic key，因此不会高频播报。
- 颜色回归 gate 要求普通文本对比至少 4.5:1，交互边界/控件文字至少 3:1；视觉状态不能只依赖颜色。

## 自动化证据与上限

- component tests 覆盖 page/card header、StatusRow 关联、操作唯一名称/role/hint/state、48dp、focus、公告
  去重及不公告高频/敏感内容；theme test 覆盖文本和交互边界 contrast gate。
- API 36 emulator semantic smoke 验证四个 tab 的唯一 accessibility label/selected state；保存原字号后设为
  200%，force-stop/relaunch，逐页滚动并操作 Activity clear/cancel/confirm，复核关键 action bounds 至少
  48dp，最后恢复原字号。
- UIAutomator 只观察语义树、selected state、bounds 和点击。本轮没有开启 Android TalkBack，也没有
  VoiceOver、Switch Access、iOS 200% Dynamic Type 或双端真机人工证据；不能声称实际朗读、手势/rotor
  顺序、平台焦点顺序和真机可访问性已完成。

## 事实真源

- primitives：`src/ui/components/Screen.tsx`、`StatusCard.tsx`、`AccessibleAction.tsx`
- focus/announcement：`src/ui/accessibility.ts`
- tab labels：`src/ui/navigation.ts`
- tests：`src/ui/components/__tests__/accessibilityComponents.test.tsx`、
  `src/ui/components/__tests__/PendingConfirmationModal.test.tsx`、`src/ui/__tests__/accessibility.test.tsx`、
  `src/ui/__tests__/themeContrast.test.ts`
- 验收：`docs/DOD.md`、`docs/verification/2026-08-19-android-emulator.md`
