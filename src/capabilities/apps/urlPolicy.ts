import { ToolExecutionError } from '@/capabilities/types'

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export type AllowedAppUrl = Readonly<{
  host: string
  url: string
}>

export function validateAllowedAppUrl(
  rawUrl: string,
  allowedHosts: ReadonlySet<string>,
): AllowedAppUrl {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ToolExecutionError('invalid_argument', 'handoff 目标不是有效 URL', false)
  }
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.port !== '' && url.port !== '443')
    || url.hash !== ''
    || isIpLiteral(hostname)
  ) {
    throw new ToolExecutionError(
      'url_not_allowed',
      'handoff 只接受无凭证、无 fragment、标准端口的 HTTPS hostname',
      false,
    )
  }
  if (!allowedHosts.has(hostname)) {
    throw new ToolExecutionError('url_not_allowed', 'handoff hostname 不在设备 allowlist', false)
  }
  return { host: hostname, url: url.toString() }
}
