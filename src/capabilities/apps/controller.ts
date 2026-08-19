import { ToolExecutionError } from '@/capabilities/types'

import { assertHandoffMayStart, boundedCanOpen } from './boundedLinkingProbe'
import { validateAllowedAppUrl } from './urlPolicy'

import type { AppLinkingAdapter } from './linkingAdapter'

export type AppUrlTarget = Readonly<{
  host: string
  kind: 'https'
}>

export class AppHandoffController {
  constructor(
    private readonly linking: AppLinkingAdapter,
    private readonly allowedHosts: ReadonlySet<string>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  hasConfiguredTarget(): boolean {
    return this.allowedHosts.size > 0
  }

  probe(): boolean {
    return this.linking.probe()
  }

  validate(rawUrl: string): Readonly<{ host: string }> {
    return validateAllowedAppUrl(rawUrl, this.allowedHosts)
  }

  async canOpen(
    rawUrl: string,
    signal: AbortSignal,
    expiresAt: string,
  ): Promise<Readonly<{
    canOpen: boolean
    target: AppUrlTarget
  }>> {
    const allowed = validateAllowedAppUrl(rawUrl, this.allowedHosts)
    return {
      canOpen: await boundedCanOpen(
        () => this.linking.canOpen(allowed.url),
        signal,
        expiresAt,
        this.clock,
      ),
      target: { host: allowed.host, kind: 'https' },
    }
  }

  async open(rawUrl: string, signal: AbortSignal, expiresAt: string): Promise<Readonly<{
    status: 'handed_off'
    target: AppUrlTarget
  }>> {
    const allowed = validateAllowedAppUrl(rawUrl, this.allowedHosts)
    assertHandoffMayStart(signal, expiresAt, this.clock)
    if (!await boundedCanOpen(
      () => this.linking.canOpen(allowed.url),
      signal,
      expiresAt,
      this.clock,
    )) {
      throw new ToolExecutionError('unavailable', '系统没有可处理该 HTTPS URL 的 App', false)
    }
    assertHandoffMayStart(signal, expiresAt, this.clock)
    await this.linking.open(allowed.url)
    return {
      status: 'handed_off',
      target: { host: allowed.host, kind: 'https' },
    }
  }
}
