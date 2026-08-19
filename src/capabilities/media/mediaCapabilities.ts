import {
  mediaPlayArgumentsSchema,
  mediaSessionArgumentsSchema,
} from './schema'

import type { MediaSessionController, MediaSessionSnapshot } from './controller'
import type { MediaPlayArguments, MediaSessionArguments } from './schema'
import type { CapabilityAvailability, MobileCapability } from '@/capabilities/types'

async function probe(controller: MediaSessionController): Promise<CapabilityAvailability> {
  if (!controller.hasConfiguredSource()) {
    return { reason: 'media_hosts_unconfigured', status: 'unavailable' }
  }
  return await controller.probePlayback()
    ? { status: 'available' }
    : { reason: 'audio_module_unavailable', status: 'unavailable' }
}

export function createMediaPlayCapability(
  controller: MediaSessionController,
): MobileCapability<MediaPlayArguments, MediaSessionSnapshot> {
  return {
    confirmationDetails: argumentsValue => [{
      label: '媒体',
      value: argumentsValue.title,
    }, {
      label: '来源 hostname',
      value: controller.validateSource(argumentsValue.source.url).host,
    }],
    descriptor: {
      confirmation: 'when_locked',
      description: '播放设备 allowlist 内的 HTTPS 音频，并显示系统媒体控制',
      effect: 'write',
      limits: {
        maxResultBytes: 8_192,
        rate: { maxGlobal: 20, maxPerCaller: 10, windowSeconds: 60 },
      },
      path: 'phone/media',
      queuePolicy: 'reject_offline',
      risk: 'medium',
      tool: 'play',
    },
    execute: (argumentsValue, _context, invocation, signal) => (
      controller.play(argumentsValue, invocation.caller.subjectId, signal)
    ),
    inputSchema: mediaPlayArgumentsSchema,
    preflight: argumentsValue => {
      controller.validateSource(argumentsValue.source.url)
    },
    probe: async () => probe(controller),
  }
}

export function createMediaPauseCapability(
  controller: MediaSessionController,
): MobileCapability<MediaSessionArguments, MediaSessionSnapshot> {
  return createSessionCapability(controller, 'pause')
}

export function createMediaResumeCapability(
  controller: MediaSessionController,
): MobileCapability<MediaSessionArguments, MediaSessionSnapshot> {
  return createSessionCapability(controller, 'resume')
}

export function createMediaStopCapability(
  controller: MediaSessionController,
): MobileCapability<MediaSessionArguments, MediaSessionSnapshot | null> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '停止 App 自有媒体会话并移除系统媒体控制',
      effect: 'write',
      limits: {
        maxResultBytes: 8_192,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/media',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'stop',
    },
    execute: argumentsValue => controller.stop(argumentsValue.sessionId),
    inputSchema: mediaSessionArgumentsSchema,
    probe: async () => probe(controller),
  }
}

export function createMediaStatusCapability(
  controller: MediaSessionController,
): MobileCapability<MediaSessionArguments, MediaSessionSnapshot> {
  return {
    descriptor: {
      confirmation: 'never',
      description: '读取 App 自有媒体会话的结构化本地状态',
      effect: 'read',
      limits: {
        maxResultBytes: 8_192,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/media',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: 'status',
    },
    execute: argumentsValue => Promise.resolve(controller.status(argumentsValue.sessionId)),
    inputSchema: mediaSessionArgumentsSchema,
    probe: async () => probe(controller),
  }
}

function createSessionCapability(
  controller: MediaSessionController,
  operation: 'pause' | 'resume',
): MobileCapability<MediaSessionArguments, MediaSessionSnapshot> {
  return {
    descriptor: {
      confirmation: 'never',
      description: `${operation === 'pause' ? '暂停' : '继续'} App 自有媒体会话`,
      effect: 'write',
      limits: {
        maxResultBytes: 8_192,
        rate: { maxGlobal: 120, maxPerCaller: 60, windowSeconds: 60 },
      },
      path: 'phone/media',
      queuePolicy: 'reject_offline',
      risk: 'low',
      tool: operation,
    },
    execute: argumentsValue => controller[operation](argumentsValue.sessionId),
    inputSchema: mediaSessionArgumentsSchema,
    probe: async () => probe(controller),
  }
}
