import type {
  InboxMessageCategory,
  InboxMessageUrgency,
} from '@/inbox/types'

export const CATEGORY_LABEL: Readonly<Record<InboxMessageCategory, string>> = {
  message: '消息',
  news: '新闻',
  subscription: '订阅',
  update: '更新',
}

export const URGENCY_LABEL: Readonly<Record<InboxMessageUrgency, string>> = {
  critical: '紧急',
  high: '高',
  low: '低',
  normal: '普通',
}

const MINUTE_MS = 60 * 1_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// 把 ISO 收件时间投影成新闻/邮件式相对时间；只用于视觉展示，
// 不进入 accessibility announcement，也不改变任何持久化时间事实。
export function formatRelativeTime(iso: string, now?: Date): string {
  const target = Date.parse(iso)
  if (Number.isNaN(target)) return iso
  const reference = (now ?? new Date()).getTime()
  const diff = reference - target
  if (diff < 0) return '刚刚'
  if (diff < MINUTE_MS) return '刚刚'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小时前`
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)} 天前`
  return formatAbsoluteTime(iso)
}

// 稳定的本地日期时间展示；对无法解析的输入回退为原字符串。
export function formatAbsoluteTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = parsed.getFullYear()
  const month = pad(parsed.getMonth() + 1)
  const day = pad(parsed.getDate())
  const hour = pad(parsed.getHours())
  const minute = pad(parsed.getMinutes())
  return `${year}-${month}-${day} ${hour}:${minute}`
}

// 把 Markdown 压成单行纯文本摘要，供列表预览使用。
export function markdownSummary(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '[图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^[#>\-*+\d.\s]+/gmu, '')
    .replace(/[*_~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}
