import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { SafeMarkdown } from '../SafeMarkdown'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'
import type { InboxLinkOpener } from '@/inbox/linkOpener'

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
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={resolver}
        linkOpener={linkOpener}
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
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const markdown = Array.from({ length: 5 }, (_, index) => (
      `![图片 ${index + 1}](https://img.example.com/${index + 1}.png)`
    )).join('\n\n')
    const rendered = await render(
      <SafeMarkdown imageResolver={resolver} linkOpener={linkOpener} markdown={markdown} />,
    )

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
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={resolver}
        linkOpener={linkOpener}
        markdown="![本地图片](https://127.0.0.1/chart.png)"
      />,
    )

    rendered.getByText('图片地址无效')
    const action = rendered.getByRole('button', { name: '加载 Markdown 图片：本地图片' })
    expect(action).toBeDisabled()
    await fireEvent.press(action)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  test('只在用户点击后打开结构合规的 HTTPS Markdown 链接', async () => {
    const imageResolver: InboxImageSourceResolver = {
      resolve: jest.fn(async () => resolvedImage()),
    }
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={imageResolver}
        linkOpener={linkOpener}
        markdown="阅读 [发布说明](https://docs.example.com/releases?id=1#latest)。"
      />,
    )

    const link = rendered.getByRole('link', { name: '发布说明' })
    expect(linkOpener.open).not.toHaveBeenCalled()
    await fireEvent.press(link)
    expect(linkOpener.open).toHaveBeenCalledWith('https://docs.example.com/releases?id=1#latest')
  })

  test('不安全 scheme 和 IP literal 只显示文字，不产生链接入口', async () => {
    const imageResolver: InboxImageSourceResolver = {
      resolve: jest.fn(async () => resolvedImage()),
    }
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={imageResolver}
        linkOpener={linkOpener}
        markdown={[
          '[执行脚本](javascript:alert(1))',
          '[本机](https://127.0.0.1/admin)',
          '[非标准端口](https://docs.example.com:8443/admin)',
          '[自定义](tool-bridge://open)',
          'https://docs.example.com/bare',
        ].join(' ')}
      />,
    )

    expect(rendered.queryAllByRole('link')).toHaveLength(0)
    rendered.getByText('[执行脚本](javascript:alert(1)) ')
    rendered.getByText('本机')
    rendered.getByText('非标准端口')
    rendered.getByText('自定义')
    expect(linkOpener.open).not.toHaveBeenCalled()
  })

  test('同一链接的多样式文字只形成一个可访问链接', async () => {
    const imageResolver: InboxImageSourceResolver = {
      resolve: jest.fn(async () => resolvedImage()),
    }
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={imageResolver}
        linkOpener={linkOpener}
        markdown={'[普通 **加粗** 和 `代码`](https://docs.example.com/guide)'}
      />,
    )

    expect(rendered.getAllByRole('link')).toHaveLength(1)
    await fireEvent.press(rendered.getByRole('link'))
    expect(linkOpener.open).toHaveBeenCalledTimes(1)
  })

  test('相邻且目标相同的两个 Markdown 链接仍保持两个入口', async () => {
    const imageResolver: InboxImageSourceResolver = {
      resolve: jest.fn(async () => resolvedImage()),
    }
    const linkOpener: InboxLinkOpener = { open: jest.fn(async () => undefined) }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={imageResolver}
        linkOpener={linkOpener}
        markdown={'[甲](https://docs.example.com)[乙](https://docs.example.com)'}
      />,
    )

    expect(rendered.getAllByRole('link')).toHaveLength(2)
  })

  test('系统拒绝打开时显示失败提示', async () => {
    const imageResolver: InboxImageSourceResolver = {
      resolve: jest.fn(async () => resolvedImage()),
    }
    const linkOpener: InboxLinkOpener = {
      open: jest.fn(async () => { throw new Error('unavailable') }),
    }
    const rendered = await render(
      <SafeMarkdown
        imageResolver={imageResolver}
        linkOpener={linkOpener}
        markdown="[打开](https://docs.example.com/)"
      />,
    )

    await fireEvent.press(rendered.getByRole('link', { name: '打开' }))
    await waitFor(() => rendered.getByRole('alert', { name: '无法打开链接。' }))
  })
})
