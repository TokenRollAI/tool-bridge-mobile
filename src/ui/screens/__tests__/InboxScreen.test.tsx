import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { InboxScreen } from '../InboxScreen'

import type { ResolvedInboxImage } from '@/inbox/imageSource'
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

function resolvedImage(): ResolvedInboxImage {
  return {
    height: 100,
    mimeType: 'image/png',
    release: jest.fn(async () => undefined),
    sizeBytes: 100,
    uri: 'file:///private/chart.png',
    width: 200,
  }
}

function screenProps(overrides: Partial<React.ComponentProps<typeof InboxScreen>> = {}) {
  return {
    messages: [recentMessage, earlierMessage],
    now: new Date('2026-08-23T10:30:00.000Z'),
    onClearInbox: jest.fn(async () => 2),
    onMarkAllRead: jest.fn(async () => 1),
    onMarkRead: jest.fn(async () => undefined),
    onResolveImage: jest.fn(async () => resolvedImage()),
    onViewOptionsChange: jest.fn(async () => undefined),
    unreadCount: 1,
    viewOptions: defaultView,
    ...overrides,
  }
}

describe('InboxScreen', () => {
  test('展示 title、显式紧急程度、可信收件时间与可选 Agent 发送时间', async () => {
    const rendered = await render(<InboxScreen {...screenProps()} />)

    rendered.getByRole('header', { name: '信箱' })
    rendered.getByLabelText('当前结果：2 条')
    rendered.getByLabelText('结果中最近半小时：1 条')
    rendered.getByLabelText('全部未读：1 条')
    rendered.getByRole('header', { name: '未读 · 高 · 今日订阅摘要' })
    rendered.getByLabelText('紧急程度：高')
    rendered.getByLabelText('发送时间（Agent 提供）：2026-08-23T10:10:00.000Z')
    rendered.getByLabelText('收到时间：2026-08-23T10:15:00.000Z')
    rendered.getByRole('header', { name: '普通 · 产品更新' })
    expect(rendered.queryByLabelText(/发送时间（Agent 提供）：2026-08-23T09/)).toBeNull()
    expect(rendered.queryByText('sensitive_command_id')).toBeNull()
  })

  test('默认只显示纯文本摘要，展开后渲染 Markdown，图片显式点击前零请求', async () => {
    const onResolveImage = jest.fn(async () => resolvedImage())
    const rendered = await render(<InboxScreen {...screenProps({ onResolveImage })} />)

    expect(rendered.queryByRole('header', { name: '今日重点' })).toBeNull()
    expect(onResolveImage).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', {
      name: '查看 Daily Agent 于 2026-08-23T10:15:00.000Z 的信箱消息内容',
    }))
    rendered.getByRole('header', { name: '今日重点' })
    rendered.getByText('值得阅读')
    expect(onResolveImage).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '加载 Markdown 图片：趋势图' }))
    await waitFor(() => expect(onResolveImage).toHaveBeenCalledWith(
      'https://img.example.com/chart.png',
      expect.any(Object),
    ))
    await waitFor(() => rendered.getByLabelText('趋势图'))
  })

  test('搜索由用户明确提交，排序值来自固定选项', async () => {
    const onViewOptionsChange = jest.fn(async () => undefined)
    const rendered = await render(<InboxScreen {...screenProps({ onViewOptionsChange })} />)

    await fireEvent.changeText(rendered.getByLabelText('搜索本机信箱'), 'Daily')
    rendered.getByDisplayValue('Daily')
    expect(onViewOptionsChange).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '执行本机信箱搜索' }))
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

  test('全部标为已读返回真实更新数，单条已读操作仍可用', async () => {
    const onMarkAllRead = jest.fn(async () => 1)
    const onMarkRead = jest.fn(async () => undefined)
    const rendered = await render(<InboxScreen {...screenProps({ onMarkAllRead, onMarkRead })} />)

    await fireEvent.press(rendered.getByRole('button', { name: '将本机信箱全部标为已读' }))
    await waitFor(() => rendered.getByText('已将 1 条本机信箱消息标为已读。'))
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)

    await fireEvent.press(rendered.getByRole('button', {
      name: '将 Daily Agent 于 2026-08-23T10:15:00.000Z 的信箱消息标为已读',
    }))
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith(recentMessage.messageId))
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
