import * as Crypto from 'expo-crypto'
import { Directory, File, FileMode, Paths } from 'expo-file-system'

import type { InboxImageCacheFile, InboxImageCacheStore } from './imageSource'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export class ExpoInboxImageCacheStore implements InboxImageCacheStore {
  readonly #directory = new Directory(Paths.cache, 'tool-bridge-inbox-images')
  #initialized = false

  async create(mimeType: string): Promise<InboxImageCacheFile> {
    this.#initialize()
    const extension = EXTENSIONS[mimeType] ?? 'image'
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
