import { throwIfSignalAborted } from '@/capabilities/abortSignal'
import { createReactNativeAbortSignal } from '@/testFixtures/reactNativeAbortSignal'

describe('throwIfSignalAborted', () => {
  test('兼容 React Native 缺少 throwIfAborted 的未取消 signal', () => {
    const signal = createReactNativeAbortSignal()

    expect('throwIfAborted' in signal).toBe(false)
    expect(() => throwIfSignalAborted(signal)).not.toThrow()
  })

  test('React Native signal 已取消时抛出可识别的 AbortError', () => {
    expect(() => throwIfSignalAborted(createReactNativeAbortSignal(true))).toThrow(
      expect.objectContaining({ message: 'Aborted', name: 'AbortError' }),
    )
  })

  test('宿主提供标准 reason 时保留原始取消原因', () => {
    const reason = new Error('fixture abort reason')
    reason.name = 'AbortError'
    const signal = { aborted: true, reason } as AbortSignal

    expect(() => throwIfSignalAborted(signal)).toThrow(reason)
  })
})
