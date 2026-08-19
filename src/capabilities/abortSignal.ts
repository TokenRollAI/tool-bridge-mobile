type AbortSignalWithReason = AbortSignal & Readonly<{ reason: unknown }>

/**
 * React Native 0.86 使用的 abort-controller@3 只有 aborted/event API，
 * 不提供较新的 AbortSignal.throwIfAborted()。能力实现统一通过这里检查，
 * 避免把宿主运行时的可选方法当成协议前提。
 */
export function throwIfSignalAborted(signal: AbortSignal): void {
  if (!signal.aborted) return

  if ('reason' in signal) throw (signal as AbortSignalWithReason).reason

  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}
