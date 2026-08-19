import { LocalRevocationCoordinator } from '../localRevocationCoordinator'

describe('LocalRevocationCoordinator', () => {
  afterEach(() => jest.useRealTimers())

  test('先禁用策略，再停止 realtime/mailbox，最后清除安全凭证', async () => {
    const events: string[] = []
    const coordinator = new LocalRevocationCoordinator({
      credentialStore: {
        clear: async () => { events.push('credential:clear') },
        get: async () => null,
        save: async () => undefined,
      },
      localRuntime: {
        emergencyDisable: async () => {
          events.push('runtime:disable')
          return { localEffectStopFailures: 0 }
        },
      },
      mailboxTransport: {
        stopForLocalRevocation: async () => { events.push('mailbox:stop') },
      },
      realtimeTransport: {
        stopForLocalRevocation: async () => { events.push('realtime:stop') },
      },
    })

    await expect(coordinator.revoke()).resolves.toEqual({
      localRuntimeStopFailed: false,
      status: 'revoked_locally',
      transportStopFailures: 0,
    })
    expect(events[0]).toBe('runtime:disable')
    expect(events.at(-1)).toBe('credential:clear')
  })

  test('transport stop 失败时仍清凭证并报告降级', async () => {
    let credentialCleared = false
    const coordinator = new LocalRevocationCoordinator({
      credentialStore: {
        clear: async () => { credentialCleared = true },
        get: async () => null,
        save: async () => undefined,
      },
      localRuntime: {
        emergencyDisable: async () => ({ localEffectStopFailures: 0 }),
      },
      mailboxTransport: { stopForLocalRevocation: async () => undefined },
      realtimeTransport: {
        stopForLocalRevocation: async () => { throw new Error('fixture transport failure') },
      },
    })

    await expect(coordinator.revoke()).resolves.toEqual({
      localRuntimeStopFailed: false,
      status: 'revoked_locally_stop_incomplete',
      transportStopFailures: 1,
    })
    expect(credentialCleared).toBe(true)
  })

  test('runtime/transport 悬挂时在有界超时后仍清凭证并报告降级', async () => {
    jest.useFakeTimers()
    let credentialCleared = false
    const never = () => new Promise<void>(() => undefined)
    const neverRuntime = () => new Promise<Readonly<{ localEffectStopFailures: number }>>(
      () => undefined,
    )
    const coordinator = new LocalRevocationCoordinator({
      credentialStore: {
        clear: async () => { credentialCleared = true },
        get: async () => null,
        save: async () => undefined,
      },
      localRuntime: { emergencyDisable: neverRuntime },
      mailboxTransport: { stopForLocalRevocation: async () => undefined },
      realtimeTransport: { stopForLocalRevocation: never },
      stopTimeoutMs: 1_000,
    })

    const revocation = coordinator.revoke()
    await jest.advanceTimersByTimeAsync(1_000)
    await expect(revocation).resolves.toEqual({
      localRuntimeStopFailed: true,
      status: 'revoked_locally_stop_incomplete',
      transportStopFailures: 1,
    })
    expect(credentialCleared).toBe(true)
  })
})
