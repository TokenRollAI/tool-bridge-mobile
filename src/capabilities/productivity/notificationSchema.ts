import { z } from 'zod'

const unsafeDisplayText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

function safeDisplayText(maximum: number, field: string) {
  return z.string().max(maximum).refine(value => !unsafeDisplayText.test(value), {
    message: `${field} 不能包含控制或双向覆盖字符`,
  }).transform(value => value.trim()).pipe(z.string().min(1).max(maximum))
}

export const localNotificationArgumentsSchema = z.strictObject({
  message: safeDisplayText(240, 'message'),
  purpose: safeDisplayText(120, 'purpose'),
})

export type LocalNotificationArguments = z.infer<typeof localNotificationArgumentsSchema>
