import { boundedCanOpen } from '../boundedLinkingProbe'

describe('boundedCanOpen', () => {
  afterEach(() => { jest.useRealTimers() })

  test('native probe 永不 settle 时在 5 秒本地上限失败', async () => {
    jest.useFakeTimers()
    const pending = boundedCanOpen(
      () => new Promise<boolean>(() => undefined),
      new AbortController().signal,
      '2026-08-19T01:00:00.000Z',
      () => new Date('2026-08-19T00:00:00.000Z'),
    )
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'linking_probe_timeout',
      retryable: true,
    })

    jest.advanceTimersByTime(5_000)

    await rejection
  })

  test('command deadline 早于本地上限时返回 expired', async () => {
    jest.useFakeTimers()
    const pending = boundedCanOpen(
      () => new Promise<boolean>(() => undefined),
      new AbortController().signal,
      '2026-08-19T00:00:01.000Z',
      () => new Date('2026-08-19T00:00:00.000Z'),
    )
    const rejection = expect(pending).rejects.toMatchObject({ code: 'expired' })

    jest.advanceTimersByTime(1_000)

    await rejection
  })
})
