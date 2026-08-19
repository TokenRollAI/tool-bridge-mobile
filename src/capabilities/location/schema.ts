import { z } from 'zod'

const purpose = z.string().min(1).max(120).refine(value => (
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
), {
  message: 'purpose 不能包含控制或双向覆盖字符',
})

export const currentLocationArgumentsSchema = z.strictObject({
  accuracy: z.enum(['balanced', 'high']).default('balanced'),
  purpose,
  timeoutSeconds: z.number().int().min(5).max(30).default(15),
})

export const currentLocationResultSchema = z.strictObject({
  capturedAt: z.string(),
  coordinate: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  horizontalAccuracyMeters: z.number().nonnegative().nullable(),
  mocked: z.boolean().nullable(),
  permissionAccuracy: z.enum(['precise', 'approximate', 'unknown']),
})

export type CurrentLocationArguments = z.infer<typeof currentLocationArgumentsSchema>
