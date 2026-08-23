import { z } from 'zod'

const unsafeSingleLineText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const unsafeMultilineText = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const canonicalUtcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const INBOX_BODY_MAX_CHARACTERS = 64_000

function safeSingleLine(maximum: number, field: string) {
  return z.string().max(maximum).transform(value => value.trim()).pipe(
    z.string().min(1).max(maximum).refine(value => !unsafeSingleLineText.test(value), {
      message: `${field} 不能包含控制或双向覆盖字符`,
    }),
  )
}

function safeMultiline(maximum: number, field: string) {
  return z.string().max(maximum).transform(value => (
    value.replace(/\r\n?/g, '\n').trim()
  )).pipe(
    z.string().min(1).max(maximum).refine(value => !unsafeMultilineText.test(value), {
      message: `${field} 不能包含控制或双向覆盖字符`,
    }),
  )
}

const sentAt = z.string().regex(
  canonicalUtcTimestamp,
  'sentAt 必须是规范 UTC 时间',
).refine(
  value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  { message: 'sentAt 必须是有效的规范 UTC 时间' },
)

export const inboxDeliveryArgumentsSchema = z.strictObject({
  body: safeMultiline(INBOX_BODY_MAX_CHARACTERS, 'body'),
  category: z.enum(['message', 'subscription', 'news', 'update']).default('message'),
  format: z.literal('markdown').default('markdown'),
  notify: z.boolean().default(false),
  sentAt: sentAt.optional(),
  sourceLabel: safeSingleLine(120, 'sourceLabel').optional(),
  title: safeSingleLine(120, 'title'),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
})

export const inboxNotificationResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not_requested') }),
  z.strictObject({ status: z.literal('not_attempted') }),
  z.strictObject({ status: z.literal('permission_required') }),
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({ status: z.literal('status_unknown') }),
  z.strictObject({
    notificationId: z.string(),
    status: z.literal('scheduled'),
  }),
])

export const inboxDeliveryResultSchema = z.strictObject({
  messageId: z.string(),
  notification: inboxNotificationResultSchema,
  receivedAt: z.string(),
  status: z.literal('stored'),
})

export type InboxDeliveryArguments = z.infer<typeof inboxDeliveryArgumentsSchema>
export type InboxDeliveryResult = z.infer<typeof inboxDeliveryResultSchema>
export type InboxNotificationResult = z.infer<typeof inboxNotificationResultSchema>
