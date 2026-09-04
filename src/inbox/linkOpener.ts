import { ToolExecutionError } from '@/capabilities/types'

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export type ValidatedInboxLink = Readonly<{
  host: string
  url: string
}>

export interface InboxLinkOpener {
  open(rawUrl: string): Promise<void>
}

export interface InboxLinkingAdapter {
  open(url: string): Promise<void>
}

export function validateInboxLink(rawUrl: string): ValidatedInboxLink {
  if (rawUrl.length > 2_048) {
    throw new ToolExecutionError('invalid_argument', '信箱链接不能超过 2048 个字符', false)
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ToolExecutionError('invalid_argument', '信箱链接不是有效 URL', false)
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.port !== '' && url.port !== '443')
    || isIpLiteral(hostname)
  ) {
    throw new ToolExecutionError(
      'url_not_allowed',
      '信箱链接只接受无凭证、标准端口的 HTTPS hostname',
      false,
    )
  }
  const normalizedUrl = url.toString()
  if (normalizedUrl.length > 2_048) {
    throw new ToolExecutionError('invalid_argument', '信箱链接不能超过 2048 个字符', false)
  }
  return { host: hostname, url: normalizedUrl }
}

export class SafeInboxLinkOpener implements InboxLinkOpener {
  constructor(private readonly linking: InboxLinkingAdapter) {}

  async open(rawUrl: string): Promise<void> {
    const target = validateInboxLink(rawUrl)
    await this.linking.open(target.url)
  }
}
