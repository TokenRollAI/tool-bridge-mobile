import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { InboxMessageScreen } from '../InboxMessageScreen'

import type { ResolvedInboxImage } from '@/inbox/imageSource'
import type { InboxMessage } from '@/inbox/types'

const unreadMessage: InboxMessage = {
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

function screenProps(overrides: Partial<React.ComponentProps<typeof InboxMessageScreen>> = {}) {
  return {
    message: unreadMessage,
    now: new Date('2026-08-23T10:30:00.000Z'),
    onBack: jest.fn(),
    onMarkRead: jest.fn(async () => undefined),
    onResolveImage: jest.fn(async () => resolvedImage()),
    ...overrides,
  }
}

describe('InboxMessageScreen', () => {
  test('渲染完整 Markdown 与内容元数据，且不泄露敏感 command id', async () => {
    const rendered = await render(<InboxMessageScreen {...screenProps()} />)

    rendered.getByRole('header', { name: '今日订阅摘要' })
    rendered.getByRole('header', { name: '今日重点' })
    rendered.getByText('值得阅读')
    rendered.getByText(/内容来源（Agent 提供）：Daily Brief/)
    expect(rendered.queryByText(/sensitive_command_id/)).toBeNull()
  })

  test('打开未读消息即自动标为已读，且只触发一次', async () => {
    const onMarkRead = jest.fn(async () => undefined)
    const rendered = await render(<InboxMessageScreen {...screenProps({ onMarkRead })} />)
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith(unreadMessage.messageId))

    rendered.rerender(<InboxMessageScreen {...screenProps({ onMarkRead })} />)
    expect(onMarkRead).toHaveBeenCalledTimes(1)
  })

  test('已读消息不再触发标记', async () => {
    const onMarkRead = jest.fn(async () => undefined)
    await render(<InboxMessageScreen {...screenProps({
      message: { ...unreadMessage, readAt: '2026-08-23T10:20:00.000Z' },
      onMarkRead,
    })} />)
    expect(onMarkRead).not.toHaveBeenCalled()
  })

  test('图片在用户显式点击前零网络请求，点击后走受控加载', async () => {
    const onResolveImage = jest.fn(async () => resolvedImage())
    const rendered = await render(<InboxMessageScreen {...screenProps({ onResolveImage })} />)

    expect(onResolveImage).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '加载 Markdown 图片：趋势图' }))
    await waitFor(() => expect(onResolveImage).toHaveBeenCalledWith(
      'https://img.example.com/chart.png',
      expect.any(Object),
    ))
    await waitFor(() => rendered.getByLabelText('趋势图'))
  })

  test('消息不存在时给出兜底并可返回', async () => {
    const onBack = jest.fn()
    const rendered = await render(<InboxMessageScreen {...screenProps({ message: null, onBack })} />)
    rendered.getByRole('header', { name: '消息不存在' })
    rendered.getByText('这条本机信箱消息可能已被清空或不存在。')
    await fireEvent.press(rendered.getByRole('button', { name: '返回' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
