import { render, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Platform } from 'react-native'

import { useDiscreteAccessibilityAnnouncement } from '../accessibility'

function Fixture({ semanticKey, message }: Readonly<{
  message: string | null
  semanticKey: string | null
}>) {
  useDiscreteAccessibilityAnnouncement(semanticKey, message)
  return null
}

describe('discrete accessibility announcements', () => {
  const androidAnnouncement = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined)
  const iosAnnouncement = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined)

  beforeEach(() => {
    androidAnnouncement.mockClear()
    iosAnnouncement.mockClear()
  })

  afterAll(() => {
    androidAnnouncement.mockRestore()
    iosAnnouncement.mockRestore()
  })

  function announcementCount(): number {
    return androidAnnouncement.mock.calls.length + iosAnnouncement.mock.calls.length
  }

  test('初始状态不公告；相同 semantic key 的进度变化不刷屏；离散变化只公告一次', async () => {
    const rendered = await render(<Fixture message="媒体状态 playing" semanticKey="playing" />)
    expect(announcementCount()).toBe(0)

    await rendered.rerender(<Fixture message="进度 2 秒" semanticKey="playing" />)
    expect(announcementCount()).toBe(0)

    await rendered.rerender(<Fixture message="媒体状态 paused" semanticKey="paused" />)
    await waitFor(() => expect(announcementCount()).toBe(1))
    await rendered.rerender(<Fixture message="媒体状态 paused" semanticKey="paused" />)
    expect(announcementCount()).toBe(1)

    const call = Platform.OS === 'ios'
      ? iosAnnouncement.mock.calls[0]?.[0]
      : androidAnnouncement.mock.calls[0]?.[0]
    expect(call).toBe('媒体状态 paused')
  })

  test('null key 表示没有需要朗读的状态，不产生空公告', async () => {
    const rendered = await render(<Fixture message={null} semanticKey={null} />)
    await rendered.rerender(<Fixture message={null} semanticKey={null} />)
    expect(announcementCount()).toBe(0)
  })
})
