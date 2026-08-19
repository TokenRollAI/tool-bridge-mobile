/**
 * React Native 0.86 的 abort-controller@3 signal 形状。
 * 它支持 aborted/event API，但没有 reason/throwIfAborted。
 */
export function createReactNativeAbortSignal(aborted = false): AbortSignal {
  return {
    aborted,
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    onabort: null,
    removeEventListener: () => undefined,
  } as unknown as AbortSignal
}
