import { MediaSessionController } from '@/capabilities/media/controller'
import { createMediaPlayCapability } from '@/capabilities/media/mediaCapabilities'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type {
  MediaPlaybackPort,
  MediaPlaybackPortFactory,
  MediaPlaybackRequest,
  MediaPlaybackStatus,
} from '@/capabilities/media/playbackPort'
import type { MediaSourceResolver } from '@/capabilities/media/sourceResolver'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'trusted_session',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'unconfigured',
}

class CountingMediaFactory implements MediaPlaybackPortFactory {
  starts = 0

  create(): MediaPlaybackPort {
    return {
      pause: async () => undefined,
      resume: async () => undefined,
      start: async (
        _request: MediaPlaybackRequest,
        onStatus: (status: MediaPlaybackStatus) => void,
      ) => {
        this.starts += 1
        onStatus({ currentTimeSeconds: 0, durationSeconds: 30, state: 'playing' })
      },
      stop: async () => undefined,
    }
  }

  async probe(): Promise<boolean> {
    return true
  }
}

class FixtureMediaSourceResolver implements MediaSourceResolver {
  resolutions = 0

  async resolve() {
    this.resolutions += 1
    return {
      mimeType: 'audio/mpeg',
      release: async () => undefined,
      sizeBytes: 1_024,
      uri: 'file:///private/cache/fixture.mp3',
    }
  }
}

function createHarness(options: Readonly<{
  confirmationCoordinator?: LocalConfirmationCoordinator
  controlMode?: CapabilityContext['controlMode']
}> = {}) {
  const factory = new CountingMediaFactory()
  const resolver = new FixtureMediaSourceResolver()
  const controller = new MediaSessionController(
    factory,
    new Set(['media.example.com']),
    resolver,
    { idGenerator: () => 'fixture-session' },
  )
  const registry = new CapabilityRegistry()
  registry.register(createMediaPlayCapability(controller))
  const executor = new LocalCommandExecutor({
    auditRepository: new MemoryAuditRepository(),
    clock: () => new Date('2026-08-19T00:00:01.000Z'),
    commandRepository: new MemoryCommandRepository(),
    ...(options.confirmationCoordinator === undefined
      ? {}
      : { confirmationCoordinator: options.confirmationCoordinator }),
    context: async () => ({
      ...context,
      controlMode: options.controlMode ?? context.controlMode,
    }),
    idGenerator: () => 'audit_fixture',
    policyEngine: new PolicyEngine(),
    registry,
  })
  return { controller, executor, factory, resolver }
}

const command: LocalCommand = {
  arguments: {
    source: { kind: 'https', url: 'https://media.example.com/track.mp3?ticket=secret' },
    title: 'Fixture Track',
  },
  caller: { subjectId: 'caller_a' },
  commandId: 'media_command_01',
  createdAt: '2026-08-19T00:00:00.000Z',
  expiresAt: '2026-08-19T01:00:00.000Z',
  path: 'phone/media',
  tool: 'play',
}

describe('media local runtime contract', () => {
  test('100 次重复 commandId 只创建一个 player 且结果不含完整 URL', async () => {
    const harness = createHarness()
    const outcomes = []
    for (let index = 0; index < 100; index += 1) {
      outcomes.push(await harness.executor.execute(command, new AbortController().signal))
    }

    expect(harness.factory.starts).toBe(1)
    expect(harness.resolver.resolutions).toBe(1)
    expect(new Set(outcomes.map(outcome => JSON.stringify(outcome))).size).toBe(1)
    expect(JSON.stringify(outcomes)).not.toContain('ticket=secret')
    await harness.controller.stop()
  })

  test('非 allowlist HTTPS 在 player 创建前被拒绝', async () => {
    const harness = createHarness()
    const outcome = await harness.executor.execute({
      ...command,
      arguments: {
        source: { kind: 'https', url: 'https://attacker.example/track.mp3' },
        title: 'Fixture Track',
      },
      commandId: 'media_command_disallowed',
    }, new AbortController().signal)

    expect(outcome).toMatchObject({ error: { code: 'source_not_allowed' }, ok: false })
    await expect(harness.executor.execute({
      ...command,
      arguments: {
        source: { kind: 'https', url: 'https://media.example.com/track.mp3' },
        title: '可信媒体\u202e系统设置',
      },
      commandId: 'media_command_bidi_title',
    }, new AbortController().signal)).resolves.toMatchObject({
      error: { code: 'invalid_argument' },
      ok: false,
    })
    expect(harness.factory.starts).toBe(0)
  })

  test('Ask every time 在用户单次允许前不创建 player，拒绝也无副作用', async () => {
    const coordinator = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
    })
    const approvedHarness = createHarness({
      confirmationCoordinator: coordinator,
      controlMode: 'ask_every_time',
    })
    const approved = approvedHarness.executor.execute(command, new AbortController().signal)
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(approvedHarness.factory.starts).toBe(0)
    expect(coordinator.getPending()).toHaveLength(1)
    coordinator.approve(command.commandId)
    await expect(approved).resolves.toMatchObject({ ok: true })
    expect(approvedHarness.factory.starts).toBe(1)
    await approvedHarness.controller.stop()

    const rejectedCoordinator = new LocalConfirmationCoordinator({
      clock: () => new Date('2026-08-19T00:00:01.000Z'),
    })
    const rejectedHarness = createHarness({
      confirmationCoordinator: rejectedCoordinator,
      controlMode: 'ask_every_time',
    })
    const rejected = rejectedHarness.executor.execute(
      { ...command, commandId: 'media_command_rejected' },
      new AbortController().signal,
    )
    await new Promise<void>(resolve => { setImmediate(resolve) })
    rejectedCoordinator.reject('media_command_rejected')
    await expect(rejected).resolves.toMatchObject({
      error: { code: 'user_rejected' },
      ok: false,
    })
    expect(rejectedHarness.factory.starts).toBe(0)
  })
})
