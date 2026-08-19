import { z } from 'zod'

const safeDisplayText = (maximum: number, field: string) => z.string()
  .min(1)
  .max(maximum)
  .refine(value => (
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
  ), {
    message: `${field} 不能包含控制或双向覆盖字符`,
  })

const coordinateTarget = z.strictObject({
  kind: z.literal('coordinate'),
  label: safeDisplayText(80, 'label').optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoom: z.number().int().min(2).max(21).optional(),
})

const queryTarget = z.strictObject({
  kind: z.literal('query'),
  query: safeDisplayText(200, 'query'),
})

export const openMapArgumentsSchema = z.strictObject({
  purpose: safeDisplayText(120, 'purpose'),
  target: z.discriminatedUnion('kind', [coordinateTarget, queryTarget]),
})

export type OpenMapArguments = z.infer<typeof openMapArgumentsSchema>
export type OpenMapTarget = OpenMapArguments['target']
