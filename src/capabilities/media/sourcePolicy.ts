import { ToolExecutionError } from '@/capabilities/types'

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export type AllowedMediaSource = Readonly<{
  host: string
  url: string
}>

export function validateAllowedMediaSource(
  rawUrl: string,
  allowedHosts: ReadonlySet<string>,
): AllowedMediaSource {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ToolExecutionError('invalid_argument', '媒体来源不是有效 URL', false)
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
      'source_not_allowed',
      '媒体来源必须是无凭证、无 fragment、标准端口的 HTTPS hostname',
      false,
    )
  }
  if (!allowedHosts.has(hostname)) {
    throw new ToolExecutionError('source_not_allowed', '媒体 hostname 不在设备 allowlist', false)
  }
  return { host: hostname, url: url.toString() }
}
