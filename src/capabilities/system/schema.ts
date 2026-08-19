import { z } from 'zod'

// 高特权系统能力的 strict schema。这些工具只在设备本地 direct_call / trusted_session 模式下可执行。
const unsafeUiControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

export const execShellArgumentsSchema = z.strictObject({
  command: z.string().min(1).max(8_192),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
})

export const execShellResultSchema = z.strictObject({
  exitCode: z.number().int(),
  stderr: z.string(),
  stdout: z.string(),
  truncated: z.boolean(),
})

export const clipboardGetArgumentsSchema = z.strictObject({})

export const clipboardGetResultSchema = z.strictObject({
  text: z.string(),
})

export const clipboardSetArgumentsSchema = z.strictObject({
  text: z.string().max(64_000),
})

export const clipboardSetResultSchema = z.strictObject({
  status: z.literal('set'),
})

export const openIntentArgumentsSchema = z.strictObject({
  url: z.string().min(1).max(4_096).refine(value => !unsafeUiControl.test(value), {
    message: 'URL 不能包含控制或双向覆盖字符',
  }),
})

export const openIntentResultSchema = z.strictObject({
  status: z.literal('handed_off'),
})

export const accessibilityStatusArgumentsSchema = z.strictObject({})

export const accessibilityStatusResultSchema = z.strictObject({
  enabled: z.boolean(),
})

export type ExecShellArguments = z.infer<typeof execShellArgumentsSchema>
export type ExecShellResult = z.infer<typeof execShellResultSchema>
export type ClipboardGetArguments = z.infer<typeof clipboardGetArgumentsSchema>
export type ClipboardGetResult = z.infer<typeof clipboardGetResultSchema>
export type ClipboardSetArguments = z.infer<typeof clipboardSetArgumentsSchema>
export type ClipboardSetResult = z.infer<typeof clipboardSetResultSchema>
export type OpenIntentArguments = z.infer<typeof openIntentArgumentsSchema>
export type OpenIntentResult = z.infer<typeof openIntentResultSchema>
export type AccessibilityStatusArguments = z.infer<typeof accessibilityStatusArgumentsSchema>
export type AccessibilityStatusResult = z.infer<typeof accessibilityStatusResultSchema>
