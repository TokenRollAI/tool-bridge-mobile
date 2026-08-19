import { ToolExecutionError } from '@/capabilities/types'

const MAX_LINKING_PROBE_MS = 5_000

export async function boundedCanOpen(
  operation: () => Promise<boolean>,
  signal: AbortSignal,
  expiresAt: string,
  clock: () => Date = () => new Date(),
): Promise<boolean> {
  if (signal.aborted) throw cancelled()
  const remainingMs = Date.parse(expiresAt) - clock().getTime()
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw expired()
  const deadlineWins = remainingMs <= MAX_LINKING_PROBE_MS
  const waitMs = Math.min(remainingMs, MAX_LINKING_PROBE_MS)

  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    const finish = (result: Readonly<{ error: unknown } | { value: boolean }>) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    const abort = () => { finish({ error: cancelled() }) }
    const timeout = setTimeout(() => {
      finish({
        error: deadlineWins
          ? expired()
          : new ToolExecutionError(
            'linking_probe_timeout',
            '等待系统 handoff 能力检查超过本地时限',
            true,
          ),
      })
    }, waitMs)
    signal.addEventListener('abort', abort, { once: true })
    void operation().then(
      value => { finish({ value }) },
      error => { finish({ error }) },
    )
  })
}

export function assertHandoffMayStart(
  signal: AbortSignal,
  expiresAt: string,
  clock: () => Date = () => new Date(),
): void {
  if (signal.aborted) throw cancelled()
  if (Date.parse(expiresAt) <= clock().getTime()) throw expired()
}

function cancelled(): ToolExecutionError {
  return new ToolExecutionError('cancelled', 'handoff 在系统打开前已取消', false)
}

function expired(): ToolExecutionError {
  return new ToolExecutionError('expired', 'handoff 命令已过期，未打开系统 App', false)
}
