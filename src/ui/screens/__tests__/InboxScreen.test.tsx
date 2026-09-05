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
    // 未读计数显示在过滤工具栏。
    rendered.getByText('1')
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

    await fireEvent.press(rendered.getByRole('button', { name: '选择信箱排序' }))
    await fireEvent.press(rendered.getByRole('radio', { name: '信箱排序：未读优先' }))
    await waitFor(() => expect(onViewOptionsChange).toHaveBeenCalledWith({
      searchQuery: 'Daily',
      sort: 'unread_first',
    }))
  })

  test('全部标为已读返回真实更新数', async () => {
    const onMarkAllRead = jest.fn(async () => 1)
    const rendered = await render(<InboxScreen {...screenProps({ onMarkAllRead })} />)

    await fireEvent.press(rendered.getByRole('button', { name: '信箱更多操作' }))
    await fireEvent.press(rendered.getByRole('button', { name: '将本机信箱全部标为已读' }))
    await waitFor(() => rendered.getByText('已将 1 条本机信箱消息标为已读。'))
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
  })

  test('无未读时不展示全部已读入口', async () => {
    const rendered = await render(<InboxScreen {...screenProps({ unreadCount: 0 })} />)
    await fireEvent.press(rendered.getByRole('button', { name: '信箱更多操作' }))
    expect(rendered.queryByRole('button', { name: '将本机信箱全部标为已读' })).toBeNull()
    rendered.getByText('信箱')
  })

  test('清空前二次确认并明确只删除本机信箱', async () => {
    const onClearInbox = jest.fn(async () => 2)
    const rendered = await render(<InboxScreen {...screenProps({ onClearInbox })} />)

    expect(rendered.queryByRole('button', { name: '清空本机信箱' })).toBeNull()
    await fireEvent.press(rendered.getByRole('button', { name: '信箱更多操作' }))
    await fireEvent.press(rendered.getByRole('button', { name: '清空本机信箱' }))
    rendered.getByRole('header', { name: '确认清空本机信箱？' })
    rendered.getByText(/不会删除 command 防重放记录、活动审计、设置或凭证/)
    expect(onClearInbox).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '确认清空本机信箱' }))
    await waitFor(() => rendered.getByText('已清空 2 条本机信箱消息。'))
  })

  test('空搜索结果与本地内容边界表达准确', async () => {
    const rendered = await render(<InboxScreen {...screenProps({
      messages: [],
      unreadCount: 0,
      viewOptions: { searchQuery: '不存在', sort: 'received_desc' },
    })} />)
    rendered.getByText('没有匹配的本机信箱消息。')
    rendered.getByText('“不存在”的搜索结果')
  })

  test('未读筛选受快照控制，提交成功并收到新 props 后才更新范围', async () => {
    const props = screenProps()
    const rendered = await render(<InboxScreen {...props} />)
    await fireEvent.press(rendered.getByRole('radio', { name: '只看未读消息' }))
    await waitFor(() => expect(props.onViewOptionsChange).toHaveBeenCalledWith({
      ...defaultView, unreadOnly: true,
    }))
    expect(rendered.getByRole('radio', { name: '查看全部消息' }).props.accessibilityState.selected).toBe(true)
    rendered.getByRole('button', { name: /已读，产品更新/ })
    const unreadView: InboxViewOptions = { ...defaultView, unreadOnly: true }
    await rendered.rerender(<InboxScreen {...props} messages={[recentMessage]} viewOptions={unreadView} />)
    expect(rendered.getByRole('radio', { name: '只看未读消息' }).props.accessibilityState.selected).toBe(true)
    expect(rendered.queryByRole('button', { name: /已读，产品更新/ })).toBeNull()
    await rendered.rerender(<InboxScreen {...props} messages={[]} unreadCount={0} viewOptions={unreadView} />)
    rendered.getByText('未读消息都处理完了。')
    await fireEvent.press(rendered.getByRole('radio', { name: '查看全部消息' }))
    await waitFor(() => expect(props.onViewOptionsChange).toHaveBeenLastCalledWith(defaultView))
    await rendered.rerender(<InboxScreen {...props} viewOptions={defaultView} />)
    rendered.getByRole('button', { name: /已读，产品更新/ })
  })

  test('未读过滤失败保留原选中与消息，pending 时阻止重复提交', async () => {
    let rejectChange!: (reason: Error) => void
    const onViewOptionsChange = jest.fn(() => new Promise<void>((_resolve, reject) => { rejectChange = reject }))
    const rendered = await render(<InboxScreen {...screenProps({ onViewOptionsChange })} />)
    await fireEvent.press(rendered.getByRole('radio', { name: '只看未读消息' }))
    expect(rendered.getByRole('radio', { name: '只看未读消息' }).props.accessibilityState)
      .toMatchObject({ busy: true, disabled: true, selected: false })
    await fireEvent.press(rendered.getByRole('radio', { name: '只看未读消息' }))
    expect(onViewOptionsChange).toHaveBeenCalledTimes(1)
    rejectChange(new Error('storage failed'))
    await waitFor(() => rendered.getByText('筛选失败；仍显示原来的消息范围。'))
    expect(rendered.getByRole('radio', { name: '查看全部消息' }).props.accessibilityState)
      .toMatchObject({ busy: false, disabled: false, selected: true })
    rendered.getByRole('button', { name: /已读，产品更新/ })
  })

  test('未读搜索无结果不误报整箱为空，搜索与排序保留过滤条件', async () => {
    const onViewOptionsChange = jest.fn(async () => undefined)
    const rendered = await render(<InboxScreen {...screenProps({
      messages: [], unreadCount: 0, onViewOptionsChange,
      viewOptions: { searchQuery: '产品', sort: 'received_desc', unreadOnly: true },
    })} />)
    rendered.getByText('没有匹配的未读消息。')
    rendered.getByText('“产品”的未读结果')
    expect(rendered.queryByText('最近还没有 Agent 来信。')).toBeNull()
    await fireEvent.changeText(rendered.getByLabelText('搜索本机信箱'), 'Daily')
    await fireEvent(rendered.getByLabelText('搜索本机信箱'), 'submitEditing')
    await waitFor(() => expect(onViewOptionsChange).toHaveBeenLastCalledWith({
      searchQuery: 'Daily', sort: 'received_desc', unreadOnly: true,
    }))
    await fireEvent.press(rendered.getByRole('button', { name: '选择信箱排序' }))
    await fireEvent.press(rendered.getByRole('radio', { name: '信箱排序：最早' }))
    await waitFor(() => expect(onViewOptionsChange).toHaveBeenLastCalledWith({
      searchQuery: 'Daily', sort: 'received_asc', unreadOnly: true,
    }))
  })

  test('更多面板的清空可以取消且失败时保留消息和重试入口', async () => {
    const onClearInbox = jest.fn(async () => { throw new Error('storage unavailable') })
    const rendered = await render(<InboxScreen {...screenProps({ onClearInbox })} />)
    await fireEvent.press(rendered.getByRole('button', { name: '信箱更多操作' }))
    await fireEvent.press(rendered.getByRole('button', { name: '清空本机信箱' }))
    await fireEvent.press(rendered.getByRole('button', { name: '取消清空本机信箱' }))
    expect(onClearInbox).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '清空本机信箱' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清空本机信箱' }))
    await waitFor(() => rendered.getByText('清空失败；本机信箱消息未被确认删除。'))
    rendered.getByRole('button', { name: '确认清空本机信箱' })
    await fireEvent.press(rendered.getByRole('button', { name: '取消清空本机信箱' }))
    await fireEvent.press(rendered.getByRole('button', { name: '关闭信箱操作' }))
    rendered.getByRole('button', { name: /未读，高，今日订阅摘要/ })
  })

})
