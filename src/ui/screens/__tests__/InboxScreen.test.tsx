import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { InboxScreen } from '../InboxScreen'

import type { InboxMessage, InboxViewOptions } from '@/inbox/types'

const recentMessage: InboxMessage = {
  body: '# 今日重点\n\n三条 **值得阅读** 的更新。\n\n![趋势图](https://img.example.com/chart.png)',
  callerDisplayName: 'Daily Agent',
  callerSubjectId: 'caller_daily',
  category: 'subscription',
  format: 'markdown',
  messageId: `inbox_${'a'.repeat(64)}`,
  readAt: null,
  receivedAt: '2026-08-23T10:15:00.000Z',
  sentAt: '2026-08-23T10:10:00.000Z',
  sourceCommandId: 'sensitive_command_id',
  sourceLabel: 'Daily Brief',
  title: '今日订阅摘要',
  urgency: 'high',
}

const earlierMessage: InboxMessage = {
  ...recentMessage,
  body: '较早的产品更新。',
  callerDisplayName: null,
  category: 'update',
  messageId: `inbox_${'b'.repeat(64)}`,
  readAt: '2026-08-23T09:10:00.000Z',
  receivedAt: '2026-08-23T09:00:00.000Z',
  sentAt: null,
  sourceCommandId: 'older_command_id',
  sourceLabel: null,
  title: '产品更新',
  urgency: 'normal',
}

const defaultView: InboxViewOptions = { searchQuery: '', sort: 'received_desc' }

function screenProps(overrides: Partial<React.ComponentProps<typeof InboxScreen>> = {}) {
  return {
    messages: [recentMessage, earlierMessage],
    now: new Date('2026-08-23T10:30:00.000Z'),
    onClearInbox: jest.fn(async () => 2),
    onMarkAllRead: jest.fn(async () => 1),
    onOpenMessage: jest.fn(),
    onViewOptionsChange: jest.fn(async () => undefined),
    unreadCount: 1,
    viewOptions: defaultView,
    ...overrides,
  }
}

describe('InboxScreen', () => {
  test('以新闻式列表展示标题、来源、相对时间与摘要，且不泄露敏感字段', async () => {
    const rendered = await render(<InboxScreen {...screenProps()} />)

    rendered.getByRole('header', { name: '信箱' })
    // 未读项合成可访问名称，包含未读、紧急程度、标题、来源与相对时间。
    rendered.getByRole('button', { name: '未读，高，今日订阅摘要，来自 Daily Agent，15 分钟前' })
    rendered.getByRole('button', { name: '已读，产品更新，来自 caller_daily，1 小时前' })
    // 摘要是纯视觉补充，对读屏软件隐藏（整行以合成 label 呈现），需显式包含隐藏元素查询。
    rendered.getByText(/今日重点 三条 值得阅读 的更新。/, { includeHiddenElements: true })
    // 未读计数投影到 eyebrow 徽标（视觉补充，对读屏隐藏）。
    rendered.getByText('1 条未读', { includeHiddenElements: true })
    // 敏感 command id 不出现在列表中。
    expect(rendered.queryByText(/sensitive_command_id/)).toBeNull()
  })

  test('点击列表项请求打开对应消息详情', async () => {
    const onOpenMessage = jest.fn()
    const rendered = await render(<InboxScreen {...screenProps({ onOpenMessage })} />)

    await fireEvent.press(rendered.getByRole('button', {
      name: '未读，高，今日订阅摘要，来自 Daily Agent，15 分钟前',
    }))
    expect(onOpenMessage).toHaveBeenCalledWith(recentMessage.messageId)
  })

  test('搜索由用户明确提交，排序值来自固定选项', async () => {
    const onViewOptionsChange = jest.fn(async () => undefined)
    const rendered = await render(<InboxScreen {...screenProps({ onViewOptionsChange })} />)

    await fireEvent.changeText(rendered.getByLabelText('搜索本机信箱'), 'Daily')
    rendered.getByDisplayValue('Daily')
    expect(onViewOptionsChange).not.toHaveBeenCalled()
    await fireEvent(rendered.getByLabelText('搜索本机信箱'), 'submitEditing')
    await waitFor(() => expect(onViewOptionsChange).toHaveBeenCalledWith({
      searchQuery: 'Daily',
      sort: 'received_desc',
    }))

    await fireEvent.press(rendered.getByRole('radio', { name: '信箱排序：未读优先' }))
    await waitFor(() => expect(onViewOptionsChange).toHaveBeenCalledWith({
      searchQuery: 'Daily',
      sort: 'unread_first',
    }))
  })

  test('全部标为已读返回真实更新数', async () => {
    const onMarkAllRead = jest.fn(async () => 1)
    const rendered = await render(<InboxScreen {...screenProps({ onMarkAllRead })} />)

    await fireEvent.press(rendered.getByRole('button', { name: '将本机信箱全部标为已读' }))
    await waitFor(() => rendered.getByText('已将 1 条本机信箱消息标为已读。'))
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
  })

  test('无未读时不展示全部已读入口', async () => {
    const rendered = await render(<InboxScreen {...screenProps({ unreadCount: 0 })} />)
    expect(rendered.queryByRole('button', { name: '将本机信箱全部标为已读' })).toBeNull()
    rendered.getByText('信箱')
  })

  test('清空前二次确认并明确只删除本机信箱', async () => {
    const onClearInbox = jest.fn(async () => 2)
    const rendered = await render(<InboxScreen {...screenProps({ onClearInbox })} />)

    await fireEvent.press(rendered.getByRole('button', { name: '清空本机信箱' }))
    rendered.getByRole('header', { name: '确认清空本机信箱？' })
    rendered.getByText(/不会删除 command 防重放记录、活动审计、设置或凭证/)
    expect(onClearInbox).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '确认清空本机信箱' }))
    await waitFor(() => rendered.getByText('已清空 2 条本机信箱消息。'))
  })

  test('空搜索结果与本地/离线边界表达准确', async () => {
    const rendered = await render(<InboxScreen {...screenProps({
      messages: [],
      unreadCount: 0,
      viewOptions: { searchQuery: '不存在', sort: 'received_desc' },
    })} />)
    rendered.getByText('没有匹配的本机信箱消息。')
    rendered.getByText(/离线队列与 push 尚未实现/)
  })
})
