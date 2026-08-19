import * as Crypto from 'expo-crypto'
import {
  Directory,
  File,
  FileMode,
  Paths,
} from 'expo-file-system'

import type { MediaCacheFile, MediaCacheStore } from './sourceResolver'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-wav': 'wav',
}

export class ExpoMediaCacheStore implements MediaCacheStore {
  readonly #directory = new Directory(Paths.cache, 'tool-bridge-media')
  #initialized = false

  async create(mimeType: string): Promise<MediaCacheFile> {
    this.#initialize()
    const extension = EXTENSIONS[mimeType] ?? 'audio'
    const file = new File(this.#directory, `${Crypto.randomUUID()}.${extension}`)
    file.create()
    const handle = file.open(FileMode.Truncate)
    let closed = false
    return {
      close: async () => {
        if (closed) return
        closed = true
        handle.close()
      },
      delete: async () => {
        if (!closed) {
          closed = true
          handle.close()
        }
        if (file.exists) file.delete()
      },
      uri: file.uri,
      write: async chunk => { handle.writeBytes(chunk) },
    }
  }

  #initialize(): void {
    if (this.#initialized) return
    this.#directory.create({ idempotent: true, intermediates: true })
    for (const entry of this.#directory.list()) entry.delete()
    this.#initialized = true
  }
}
