import type { DeviceCredentialStore } from '@/identity/deviceCredentialStore'

export interface RevocableLocalRuntime {
  emergencyDisable(): Promise<Readonly<{ localEffectStopFailures: number }>>
}

export interface RevocableTransport {
  stopForLocalRevocation(): Promise<void>
}

export type LocalRevocationResult = Readonly<{
  localRuntimeStopFailed: boolean
  status: 'revoked_locally' | 'revoked_locally_stop_incomplete'
  transportStopFailures: number
}>

type LocalRevocationDependencies = Readonly<{
  credentialStore: DeviceCredentialStore
  localRuntime: RevocableLocalRuntime
  mailboxTransport: RevocableTransport
  realtimeTransport: RevocableTransport
  stopTimeoutMs?: number
}>

export class LocalRevocationCoordinator {
  readonly #stopTimeoutMs: number

  constructor(private readonly dependencies: LocalRevocationDependencies) {
    this.#stopTimeoutMs = dependencies.stopTimeoutMs ?? 5_000
  }

  async revoke(): Promise<LocalRevocationResult> {
    let stops: readonly PromiseSettledResult<boolean>[] = []
    try {
      stops = await Promise.allSettled([
        withTimeout(
          async () => {
            const result = await this.dependencies.localRuntime.emergencyDisable()
            return result.localEffectStopFailures === 0
          },
          this.#stopTimeoutMs,
        ),
        withTimeout(
          async () => {
            await this.dependencies.realtimeTransport.stopForLocalRevocation()
            return true
          },
          this.#stopTimeoutMs,
        ),
        withTimeout(
          async () => {
            await this.dependencies.mailboxTransport.stopForLocalRevocation()
            return true
          },
          this.#stopTimeoutMs,
        ),
      ])
    } finally {
      // transport/runtime 拒绝或悬挂都不能跳过安全存储清理。
      await this.dependencies.credentialStore.clear()
    }
    const localRuntimeResult = stops[0]
    const localRuntimeStopFailed = localRuntimeResult?.status !== 'fulfilled'
      || !localRuntimeResult.value
    const transportStopFailures = stops.slice(1)
      .filter(result => result.status === 'rejected').length
    return {
      localRuntimeStopFailed,
      status: transportStopFailures === 0 && !localRuntimeStopFailed
        ? 'revoked_locally'
        : 'revoked_locally_stop_incomplete',
      transportStopFailures,
    }
  }
}

async function withTimeout<Result>(operation: () => Promise<Result>, timeoutMs: number): Promise<Result> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { reject(new Error('local revocation stop timeout')) }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}
