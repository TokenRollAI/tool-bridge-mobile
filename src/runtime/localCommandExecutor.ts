import * as Crypto from 'expo-crypto'
import { z } from 'zod'

import { outcomeCode, type AuditDecision, type AuditRepository } from '@/audit/types'
import { ToolExecutionError } from '@/capabilities/types'
import { localCommandSchema } from '@/commands/types'

import { LocalAdmissionController } from './localAdmissionController'

import type { CapabilityRegistry, RegisteredCapability } from '@/capabilities/registry'
import type { CapabilityContext, CapabilityDescriptor } from '@/capabilities/types'
import type { CommandRepository } from '@/commands/repository'
import type { CommandOutcome, LocalCommand, StoredCommand, ToolError } from '@/commands/types'
import type {
  ConfirmationResolution,
  LocalConfirmationCoordinator,
} from '@/policy/localConfirmationCoordinator'
import type { PolicyDecision, PolicyEngine } from '@/policy/policyEngine'

const CLIENT_VERSION = '0.1.0'

function failure(error: ToolError): CommandOutcome {
  return { error, ok: false }
}

const inProgressOutcome = failure({
  code: 'result_unknown',
  message: '命令已被领取且结果尚不明确；为避免重复副作用，不会再次执行',
  retryable: false,
})

function replayOutcome(stored: StoredCommand): CommandOutcome {
  return stored.outcome ?? inProgressOutcome
}

function outcomeForPolicy(decision: Exclude<PolicyDecision, { kind: 'allow' }>): CommandOutcome {
  if (decision.kind === 'reject') {
    return failure({
      code: decision.code,
      message: decision.message,
      retryable: decision.retryable,
    })
  }
  return failure({
    code: 'confirmation_required',
    message: `需要设备本地确认: ${decision.reason}`,
    retryable: false,
  })
}

function decisionForPolicy(decision: PolicyDecision): AuditDecision {
  if (decision.kind === 'allow') return 'allowed'
  if (decision.kind === 'awaiting_user') return 'awaiting_user'
  return 'rejected'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

type ExecutorDependencies = Readonly<{
  admissionController?: Pick<LocalAdmissionController, 'consume'>
  auditRepository: AuditRepository
  clock?: () => Date
  commandRepository: CommandRepository
  confirmationCoordinator?: Pick<LocalConfirmationCoordinator, 'request'>
  context: () => Promise<CapabilityContext>
  idGenerator?: () => string
  policyEngine: PolicyEngine
  registry: CapabilityRegistry
}>

export class LocalCommandExecutor {
  readonly #admissionController: Pick<LocalAdmissionController, 'consume'>
  readonly #abortControllers = new Map<string, AbortController>()
  readonly #clock: () => Date
  readonly #idGenerator: () => string
  readonly #inFlight = new Map<string, Promise<CommandOutcome>>()

  constructor(private readonly dependencies: ExecutorDependencies) {
    this.#admissionController = dependencies.admissionController ?? new LocalAdmissionController()
    this.#clock = dependencies.clock ?? (() => new Date())
    this.#idGenerator = dependencies.idGenerator ?? Crypto.randomUUID
  }

  async execute(input: unknown, signal: AbortSignal): Promise<CommandOutcome> {
    const parsedCommand = localCommandSchema.safeParse(input)
    if (!parsedCommand.success) {
      return failure({
        code: 'invalid_argument',
        message: '命令 envelope 不符合本地归一化 schema',
        retryable: false,
      })
    }
    const command = parsedCommand.data
    const currentExecution = this.#inFlight.get(command.commandId)
    if (currentExecution !== undefined) return currentExecution

    const abortController = new AbortController()
    const forwardAbort = () => { abortController.abort() }
    if (signal.aborted) abortController.abort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
    const execution = this.#executeCommand(command, abortController.signal)
    this.#inFlight.set(command.commandId, execution)
    this.#abortControllers.set(command.commandId, abortController)
    try {
      return await execution
    } finally {
      signal.removeEventListener('abort', forwardAbort)
      if (this.#inFlight.get(command.commandId) === execution) {
        this.#inFlight.delete(command.commandId)
        this.#abortControllers.delete(command.commandId)
      }
    }
  }

  cancelAll(): number {
    const active = [...this.#abortControllers.values()]
    for (const abortController of active) abortController.abort()
    return active.length
  }

  async #executeCommand(command: LocalCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const existing = await this.dependencies.commandRepository.get(command.commandId)
    if (existing !== null) {
      const outcome = replayOutcome(existing)
      await this.#audit(command, null, 'replayed', outcome)
      return outcome
    }

    const capability = this.dependencies.registry.resolve(command.path, command.tool)
    if (capability === null) {
      return this.#completeWithoutHandler(command, null, 'rejected', failure({
        code: 'not_found',
        message: '设备未注册该能力',
        retryable: false,
      }))
    }

    const parsed = capability.parse(command.arguments)
    if (!parsed.success) {
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'invalid_argument',
        message: '参数不符合能力 schema',
        retryable: false,
      }))
    }

    const now = this.#clock()
    if (!Number.isFinite(Date.parse(command.expiresAt)) || Date.parse(command.expiresAt) <= now.getTime()) {
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'expired',
        message: '命令已过期，未开始任何副作用',
        retryable: false,
      }))
    }
    if (signal.aborted) {
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'cancelled',
        message: '命令在开始执行前已取消',
        retryable: false,
      }))
    }

    try {
      await capability.preflight(parsed.data)
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        return this.#completeWithoutHandler(command, capability, 'rejected', failure({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        }))
      }
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'invalid_argument',
        message: '能力参数未通过本地安全预检',
        retryable: false,
      }))
    }

    let context = await this.dependencies.context()
    const admission = this.#admissionController.consume(
      capability.descriptor,
      command.caller.subjectId,
      this.#clock().getTime(),
    )
    if (!admission.allowed) {
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'rate_limited',
        message: `能力调用过于频繁，请在 ${admission.retryAfterMs}ms 后重试`,
        retryable: true,
      }))
    }
    let availability = await capability.probe(context)
    if (availability.status === 'unavailable') {
      return this.#completeWithoutHandler(command, capability, 'rejected', failure({
        code: 'unavailable',
        message: `能力当前不可用: ${availability.reason}`,
        retryable: false,
      }))
    }

    let policyDecision = this.dependencies.policyEngine.authorize(capability.descriptor, context)
    if (policyDecision.kind === 'awaiting_user' && this.dependencies.confirmationCoordinator !== undefined) {
      const resolution = await this.dependencies.confirmationCoordinator.request(
        command,
        capability.descriptor,
        capability.confirmationDetails(parsed.data),
        signal,
      )
      if (resolution !== 'approved') {
        return this.#completeWithoutHandler(
          command,
          capability,
          'rejected',
          outcomeForConfirmation(resolution),
        )
      }
      const recheck = this.#preHandlerFailure(command, signal)
      if (recheck !== null) {
        return this.#completeWithoutHandler(command, capability, 'rejected', recheck)
      }
      context = await this.dependencies.context()
      availability = await capability.probe(context)
      if (availability.status === 'unavailable') {
        return this.#completeWithoutHandler(command, capability, 'rejected', failure({
          code: 'unavailable',
          message: `本地确认后能力变为不可用: ${availability.reason}`,
          retryable: false,
        }))
      }
      policyDecision = this.dependencies.policyEngine.authorize(
        capability.descriptor,
        context,
        { locallyApproved: true },
      )
    }
    if (policyDecision.kind !== 'allow') {
      return this.#completeWithoutHandler(
        command,
        capability,
        decisionForPolicy(policyDecision),
        outcomeForPolicy(policyDecision),
      )
    }

    const claim = await this.dependencies.commandRepository.claim(command, this.#clock().toISOString())
    if (claim.kind === 'replay') return claim.outcome
    if (claim.kind === 'in_progress') return inProgressOutcome
    const claimedFailure = this.#preHandlerFailure(command, signal)
    if (claimedFailure !== null) {
      return this.#completeClaimedWithoutHandler(command, capability, claimedFailure)
    }

    let outcome: CommandOutcome
    try {
      const value = await capability.execute(parsed.data, context, {
        caller: command.caller,
        commandId: command.commandId,
        createdAt: command.createdAt,
        expiresAt: command.expiresAt,
      }, signal)
      const jsonValue = z.json().safeParse(value)
      if (!jsonValue.success) {
        outcome = failure({
            code: 'internal',
            message: '设备能力返回了非 JSON 结果',
            retryable: false,
          })
      } else if (
        utf8ByteLength(JSON.stringify(jsonValue.data)) > capability.descriptor.limits.maxResultBytes
      ) {
        outcome = failure({
          code: 'result_too_large',
          message: '设备能力结果超过本地 inline 字节上限，未写入结果存储',
          retryable: false,
        })
      } else {
        outcome = { ok: true, value: jsonValue.data }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        outcome = failure({
            code: 'cancelled',
            message: '命令执行已取消',
            retryable: false,
          })
      } else if (error instanceof ToolExecutionError) {
        outcome = failure({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        })
      } else {
        outcome = failure({
            code: 'internal',
            message: '设备能力执行失败',
            retryable: false,
          })
      }
    }

    const completedAt = this.#clock().toISOString()
    await this.dependencies.commandRepository.complete(command.commandId, outcome, completedAt)
    await this.#audit(command, capability.descriptor, 'allowed', outcome, completedAt)
    return outcome
  }

  #preHandlerFailure(command: LocalCommand, signal: AbortSignal): CommandOutcome | null {
    const now = this.#clock().getTime()
    if (Date.parse(command.expiresAt) <= now) {
      return failure({
        code: 'expired',
        message: '命令在等待本地确认时过期，未开始任何副作用',
        retryable: false,
      })
    }
    if (signal.aborted) {
      return failure({
        code: 'cancelled',
        message: '命令在等待本地确认时取消，未开始任何副作用',
        retryable: false,
      })
    }
    return null
  }

  async #completeWithoutHandler(
    command: LocalCommand,
    capability: RegisteredCapability | null,
    decision: AuditDecision,
    outcome: CommandOutcome,
  ): Promise<CommandOutcome> {
    const occurredAt = this.#clock().toISOString()
    const claim = await this.dependencies.commandRepository.claim(command, occurredAt)
    if (claim.kind === 'replay') return claim.outcome
    if (claim.kind === 'in_progress') return inProgressOutcome
    await this.dependencies.commandRepository.complete(command.commandId, outcome, occurredAt)
    await this.#audit(command, capability?.descriptor ?? null, decision, outcome, occurredAt)
    return outcome
  }

  async #completeClaimedWithoutHandler(
    command: LocalCommand,
    capability: RegisteredCapability,
    outcome: CommandOutcome,
  ): Promise<CommandOutcome> {
    const occurredAt = this.#clock().toISOString()
    await this.dependencies.commandRepository.complete(command.commandId, outcome, occurredAt)
    await this.#audit(command, capability.descriptor, 'rejected', outcome, occurredAt)
    return outcome
  }

  async #audit(
    command: LocalCommand,
    descriptor: CapabilityDescriptor | null,
    decision: AuditDecision,
    outcome: CommandOutcome,
    occurredAt = this.#clock().toISOString(),
  ): Promise<void> {
    await this.dependencies.auditRepository.add({
      callerSubjectId: command.caller.subjectId,
      clientVersion: CLIENT_VERSION,
      commandId: command.commandId,
      decision,
      effect: descriptor?.effect ?? 'unknown',
      id: this.#idGenerator(),
      occurredAt,
      outcomeCode: outcomeCode(outcome),
      path: command.path,
      risk: descriptor?.risk ?? 'unknown',
      tool: command.tool,
    })
  }
}

function outcomeForConfirmation(resolution: Exclude<ConfirmationResolution, 'approved'>): CommandOutcome {
  const errors: Record<typeof resolution, ToolError> = {
    cancelled: {
      code: 'cancelled',
      message: '本地确认等待已取消',
      retryable: false,
    },
    disabled: {
      code: 'disabled',
      message: '用户已紧急停用远程能力',
      retryable: false,
    },
    expired: {
      code: 'expired',
      message: '命令在等待本地确认时过期',
      retryable: false,
    },
    queue_full: {
      code: 'confirmation_queue_full',
      message: '设备本地确认队列已满',
      retryable: true,
    },
    rejected: {
      code: 'user_rejected',
      message: '用户在设备上拒绝了命令',
      retryable: false,
    },
  }
  return failure(errors[resolution])
}
