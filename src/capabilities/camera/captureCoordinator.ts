import { ToolExecutionError } from '@/capabilities/types'

import type { CameraCaptureArguments } from './schema'
import type { CapabilityInvocation } from '@/capabilities/types'

export type CapturedCameraPhoto = Readonly<{
  height: number
  uri: string
  width: number
}>

export type CameraCaptureRequestSnapshot = Readonly<{
  automatic: boolean
  callerDisplayName: string | null
  callerSubjectId: string
  commandId: string
  expiresAt: string
  facing: CameraCaptureArguments['facing']
  purpose: string
  quality: CameraCaptureArguments['quality']
}>

export type CameraCaptureFailure =
  | 'camera_mount_failed'
  | 'permission_denied'
  | 'user_cancelled'

type PendingCapture = Readonly<{
  abortListener: () => void
  abortSignal: AbortSignal
  reject: (error: ToolExecutionError) => void
  resolve: (photo: CapturedCameraPhoto) => void
  snapshot: CameraCaptureRequestSnapshot
  timeout: ReturnType<typeof setTimeout>
}>

export class CameraCaptureCoordinator {
  readonly #listeners = new Set<() => void>()
  #pending: PendingCapture | null = null

  getRequest(): CameraCaptureRequestSnapshot | null {
    return this.#pending?.snapshot ?? null
  }

  request(
    argumentsValue: CameraCaptureArguments,
    invocation: CapabilityInvocation,
    automatic: boolean,
    signal: AbortSignal,
  ): Promise<CapturedCameraPhoto> {
    if (this.#pending !== null) {
      throw new ToolExecutionError('camera_busy', '相机正在处理另一条拍摄请求', true)
    }
    if (signal.aborted) throw cancelledError()

    const remainingMs = Date.parse(invocation.expiresAt) - Date.now()
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw expiredError()

    const promise = new Promise<CapturedCameraPhoto>((resolve, reject) => {
      const abortListener = () => { this.#reject(cancelledError()) }
      const timeout = setTimeout(() => {
        this.#reject(expiredError())
      }, Math.min(remainingMs, 2_147_483_647))
      this.#pending = {
        abortListener,
        abortSignal: signal,
        reject,
        resolve,
        snapshot: {
          automatic,
          callerDisplayName: invocation.caller.displayName ?? null,
          callerSubjectId: invocation.caller.subjectId,
          commandId: invocation.commandId,
          expiresAt: invocation.expiresAt,
          facing: argumentsValue.facing,
          purpose: argumentsValue.purpose,
          quality: argumentsValue.quality,
        },
        timeout,
      }
      signal.addEventListener('abort', abortListener, { once: true })
    })
    this.#notify()
    return promise
  }

  fail(commandId: string, failure: CameraCaptureFailure): boolean {
    if (this.#pending?.snapshot.commandId !== commandId) return false
    const error = failure === 'user_cancelled'
      ? new ToolExecutionError('user_rejected', '用户取消了本次拍摄', false)
      : failure === 'permission_denied'
        ? new ToolExecutionError('permission_denied', '用户未授予相机权限', false)
        : new ToolExecutionError('camera_unavailable', '系统相机预览启动失败', true)
    this.#reject(error)
    return true
  }

  rejectForForegroundLoss(): boolean {
    if (this.#pending === null) return false
    this.#reject(new ToolExecutionError(
      'foreground_required',
      'App 已离开前台，本次拍摄已取消',
      false,
    ))
    return true
  }

  submit(commandId: string, photo: CapturedCameraPhoto): boolean {
    const pending = this.#pending
    if (pending?.snapshot.commandId !== commandId) return false
    this.#clearPending()
    pending.resolve(photo)
    this.#notify()
    return true
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #clearPending(): PendingCapture | null {
    const pending = this.#pending
    if (pending === null) return null
    this.#pending = null
    clearTimeout(pending.timeout)
    pending.abortSignal.removeEventListener('abort', pending.abortListener)
    return pending
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #reject(error: ToolExecutionError): void {
    const pending = this.#clearPending()
    if (pending === null) return
    pending.reject(error)
    this.#notify()
  }
}

function cancelledError(): ToolExecutionError {
  return new ToolExecutionError('cancelled', '拍摄请求已取消', false)
}

function expiredError(): ToolExecutionError {
  return new ToolExecutionError('expired', '拍摄请求已过期', false)
}
