import { assertHandoffMayStart, boundedCanOpen } from '@/capabilities/apps/boundedLinkingProbe'
import { ToolExecutionError } from '@/capabilities/types'

import { buildMapTarget } from './mapTargetBuilder'

import type { MapHandoffAdapter } from './mapHandoffAdapter'
import type { MapProvider } from './mapTargetBuilder'
import type { OpenMapArguments } from './openMapSchema'
import type { CapabilityAvailability, RuntimeAppState } from '@/capabilities/types'

export type OpenMapResult = Readonly<{
  status: 'handed_off'
  target: Readonly<{
    kind: 'map'
    provider: MapProvider
  }>
}>

export class OpenMapController {
  constructor(
    private readonly adapter: MapHandoffAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  provider(): MapProvider | null {
    const platform = this.adapter.platform()
    return platform === null ? null : buildMapTarget(platform, {
      kind: 'coordinate',
      latitude: 0,
      longitude: 0,
    }).provider
  }

  async probe(appState: RuntimeAppState): Promise<CapabilityAvailability> {
    if (appState !== 'active') return { reason: 'foreground_required', status: 'unavailable' }
    if (!this.adapter.probe()) {
      return { reason: 'linking_module_unavailable', status: 'unavailable' }
    }
    const platform = this.adapter.platform()
    if (platform === null) return { reason: 'map_platform_unsupported', status: 'unavailable' }
    return this.#probeHandler(platform)
  }

  async open(
    argumentsValue: OpenMapArguments,
    signal: AbortSignal,
    expiresAt: string,
  ): Promise<OpenMapResult> {
    const platform = this.adapter.platform()
    if (platform === null) {
      throw new ToolExecutionError('unavailable', '当前平台没有受支持的地图 handoff', false)
    }
    const target = buildMapTarget(platform, argumentsValue.target)
    assertHandoffMayStart(signal, expiresAt, this.clock)
    if (!await boundedCanOpen(
      () => this.adapter.canOpen(target.uri),
      signal,
      expiresAt,
      this.clock,
    )) {
      throw new ToolExecutionError('unavailable', '系统没有可处理地图目标的 App', false)
    }
    assertHandoffMayStart(signal, expiresAt, this.clock)
    await this.adapter.open(target.uri)
    return {
      status: 'handed_off',
      target: { kind: 'map', provider: target.provider },
    }
  }

  async #probeHandler(platform: NonNullable<ReturnType<MapHandoffAdapter['platform']>>): Promise<CapabilityAvailability> {
    const target = buildMapTarget(platform, { kind: 'coordinate', latitude: 0, longitude: 0 })
    const now = this.clock()
    try {
      const available = await boundedCanOpen(
        () => this.adapter.canOpen(target.uri),
        new AbortController().signal,
        new Date(now.getTime() + 5_001).toISOString(),
        this.clock,
      )
      return available
        ? { status: 'available' }
        : { reason: 'map_handler_unavailable', status: 'unavailable' }
    } catch {
      return { reason: 'map_handler_probe_failed', status: 'unavailable' }
    }
  }
}
