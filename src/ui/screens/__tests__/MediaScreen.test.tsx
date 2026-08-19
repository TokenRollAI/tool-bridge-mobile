import { fireEvent, render } from '@testing-library/react-native'

import { MediaScreen } from '../MediaScreen'

describe('MediaScreen', () => {
  test('展示脱敏来源、状态和本地控制', async () => {
    const onPause = jest.fn()
    const onStop = jest.fn()
    const screen = await render(
      <MediaScreen
        onPause={onPause}
        onResume={jest.fn()}
        onStop={onStop}
        session={{
          artist: 'Fixture Artist',
          callerSubjectId: 'caller_a',
          currentTimeSeconds: 3,
          durationSeconds: 30,
          mimeType: 'audio/mpeg',
          sessionId: 'media_fixture',
          sizeBytes: 1_024,
          sourceHost: 'media.example.com',
          state: 'playing',
          title: 'Fixture Track',
        }}
      />,
    )

    screen.getByRole('header', { name: '媒体' })
    screen.getByRole('header', { name: 'Fixture Track' })
    expect(screen.getByLabelText('来源：media.example.com')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: '暂停当前媒体会话' }))
    await fireEvent.press(screen.getByRole('button', { name: '停止当前媒体会话' }))
    expect(onPause).toHaveBeenCalledWith('media_fixture')
    expect(onStop).toHaveBeenCalledWith('media_fixture')
  })
})
