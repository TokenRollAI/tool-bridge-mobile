import { createCameraCaptureCapability } from '@/capabilities/camera/cameraCapability'
import { CameraCaptureCoordinator } from '@/capabilities/camera/captureCoordinator'
import { CameraCaptureController } from '@/capabilities/camera/controller'
import { CapabilityRegistry } from '@/capabilities/registry'
import { LocalConfirmationCoordinator } from '@/policy/localConfirmationCoordinator'
import { PolicyEngine } from '@/policy/policyEngine'
import { LocalCommandExecutor } from '@/runtime/localCommandExecutor'
import {
  MemoryAuditRepository,
  MemoryCommandRepository,
} from '@/storage/memoryRepositories'

import type {
  CameraPhotoProcessor,
  CameraPlatformAdapter,
} from '@/capabilities/camera/cameraAdapter'
import type { CameraObjectUploader } from '@/capabilities/camera/controller'
import type { CapabilityContext } from '@/capabilities/types'
import type { LocalCommand } from '@/commands/types'

const context: CapabilityContext = {
  appState: 'active',
  controlMode: 'ask_every_time',
  installationId: 'installation_00000000-0000-4000-8000-000000000000',
  reachability: 'online',
}

function command(commandId: string): LocalCommand {
  return {
    arguments: { facing: 'back', purpose: '检查设备指示灯', quality: 'low' },
    caller: { displayName: 'Fixture Caller', subjectId: 'caller_camera' },
    commandId,
    createdAt: '2026-08-26T01:00:00.000Z',
    expiresAt: '2099-08-26T01:01:00.000Z',
    path: 'phone/camera',
    tool: 'capture_photo',
  }
}

describe('camera local runtime contract', () => {
  test('缺少 call-scoped Store capability 时在本地确认和相机 probe 前拒绝', async () => {
    const platform: CameraPlatformAdapter = {
      getAvailableFacings: jest.fn(async (): Promise<readonly ('back' | 'front')[]> => ['back']),
      getPermission: jest.fn(async () => ({ canAskAgain: true, status: 'granted' as const })),
      requestPermission: jest.fn(async () => ({ canAskAgain: true, status: 'granted' as const })),
    }
    const coordinator = new CameraCaptureCoordinator()
    const controller = new CameraCaptureController(
      coordinator,
      platform,
      {} as CameraPhotoProcessor,
      {} as CameraObjectUploader,
    )
    const registry = new CapabilityRegistry()
    registry.register(createCameraCaptureCapability(controller))
    const confirmations = new LocalConfirmationCoordinator()
    const executor = new LocalCommandExecutor({
      auditRepository: new MemoryAuditRepository(),
      clock: () => new Date('2026-08-26T01:00:01.000Z'),
      commandRepository: new MemoryCommandRepository(),
      confirmationCoordinator: confirmations,
      context: async () => context,
      policyEngine: new PolicyEngine(),
      registry,
    })

    await expect(executor.execute(command('camera_without_store'), new AbortController().signal))
      .resolves.toMatchObject({
        error: { code: 'camera_upload_unavailable', retryable: false },
        ok: false,
      })
    expect(confirmations.getPending()).toEqual([])
    expect(platform.getAvailableFacings).not.toHaveBeenCalled()
    expect(coordinator.getRequest()).toBeNull()
  })
})
