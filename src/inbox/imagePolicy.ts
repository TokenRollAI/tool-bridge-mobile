import { ToolExecutionError } from '@/capabilities/types'

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export type ValidatedInboxImageSource = Readonly<{
  host: string
  url: string
}>

export function validateInboxImageSource(rawUrl: string): ValidatedInboxImageSource {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ToolExecutionError('invalid_argument', '信箱图片来源不是有效 URL', false)
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
      'image_source_not_allowed',
      '信箱图片必须是无凭证、无 fragment、标准端口的 HTTPS hostname',
      false,
    )
  }
  return { host: hostname, url: url.toString() }
}
