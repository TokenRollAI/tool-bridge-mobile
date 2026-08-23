import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { SafeMarkdown } from '../SafeMarkdown'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'

function resolvedImage(): ResolvedInboxImage {
  return {
    height: 100,
    mimeType: 'image/png',
    release: jest.fn(async () => undefined),
    sizeBytes: 24,
    uri: 'file:///private/image.png',
    width: 200,
  }
}

describe('SafeMarkdown', () => {
  test('把 Markdown token 渲染为原生文本，raw HTML 只作为文字', async () => {
    const resolver: InboxImageSourceResolver = { resolve: jest.fn(async () => resolvedImage()) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={resolver}
        markdown={'# 标题\n\n**重点** 和 `代码`\n\n<script>alert(1)</script>'}
      />,
    )

    rendered.getByRole('header', { name: '标题' })
    rendered.getByText('重点')
    rendered.getByText('代码')
    rendered.getByText('<script>alert(1)</script>')
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  test('每条最多投影四个图片加载入口且点击前不请求', async () => {
    const resolver: InboxImageSourceResolver = { resolve: jest.fn(async () => resolvedImage()) }
    const markdown = Array.from({ length: 5 }, (_, index) => (
      `![图片 ${index + 1}](https://img.example.com/${index + 1}.png)`
    )).join('\n\n')
    const rendered = await render(<SafeMarkdown imageResolver={resolver} markdown={markdown} />)

    expect(rendered.getAllByRole('button', { name: /加载 Markdown 图片/ })).toHaveLength(4)
    rendered.getByText('其余 Markdown 图片已省略（每条最多 4 张）。')
    expect(resolver.resolve).not.toHaveBeenCalled()
    await fireEvent.press(rendered.getByRole('button', { name: '加载 Markdown 图片：图片 1' }))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledWith(
      'https://img.example.com/1.png',
      expect.any(Object),
    ))
  })

  test('不安全图片 URL 的加载入口保持禁用且不调用 resolver', async () => {
    const resolver: InboxImageSourceResolver = { resolve: jest.fn(async () => resolvedImage()) }
    const rendered = await render(
      <SafeMarkdown imageResolver={resolver} markdown="![本地图片](https://127.0.0.1/chart.png)" />,
    )

    rendered.getByText('图片地址无效')
    const action = rendered.getByRole('button', { name: '加载 Markdown 图片：本地图片' })
    expect(action).toBeDisabled()
    await fireEvent.press(action)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })
})
