import { z } from 'zod'

const unsafeDisplayText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const canonicalUtcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const timerIdPattern = /^timer_[a-f0-9]{64}$/

const timerId = z.string().regex(timerIdPattern, 'timerId 格式无效')
const firesAt = z.string().regex(canonicalUtcTimestamp, 'firesAt 必须是规范 UTC 时间').refine(
  value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  { message: 'firesAt 必须是有效的规范 UTC 时间' },
)
const purpose = z.string().max(120).refine(
  value => !unsafeDisplayText.test(value),
  { message: 'purpose 不能包含控制或双向覆盖字符' },
).transform(value => value.trim()).pipe(z.string().min(1).max(120))

export const timerStartArgumentsSchema = z.strictObject({ firesAt, purpose })
export const timerReferenceArgumentsSchema = z.strictObject({ timerId })

export type TimerStartArguments = z.infer<typeof timerStartArgumentsSchema>
export type TimerReferenceArguments = z.infer<typeof timerReferenceArgumentsSchema>

export function isTimerId(value: string): boolean {
  return timerIdPattern.test(value)
}
