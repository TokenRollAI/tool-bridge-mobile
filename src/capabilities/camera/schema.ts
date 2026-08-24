import { z } from 'zod'

export const CAMERA_UPLOAD_CONTEXT_PATH = 'camera/photos'
export const CAMERA_MAX_RESULT_BYTES = 10 * 1024 * 1024
export const CAMERA_MAX_RAW_BYTES = 30 * 1024 * 1024

const safePurpose = z.string().trim().min(1).max(120).refine(
  value => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value),
  'purpose 不能包含控制或双向覆盖字符',
)

export const cameraCaptureArgumentsSchema = z.strictObject({
  facing: z.enum(['front', 'back']).default('back'),
  purpose: safePurpose,
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
})

export const cameraCaptureResultSchema = z.strictObject({
  bytes: z.number().int().positive().max(CAMERA_MAX_RESULT_BYTES),
  height: z.number().int().positive(),
  mimeType: z.literal('image/jpeg'),
  objectRef: z.string().max(2_048).regex(/^node:\/\/[a-z0-9][a-z0-9_./-]*$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
})

export type CameraCaptureArguments = z.infer<typeof cameraCaptureArgumentsSchema>
export type CameraCaptureResult = z.infer<typeof cameraCaptureResultSchema>
