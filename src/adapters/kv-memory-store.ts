import type { MemoryStore } from '../usecases/memory-store'
import type { MemoryEntry } from '../entities/memory-entry'

const KEY_PREFIX = 'memory:'

export class KVMemoryStoreAdapter implements MemoryStore {
  constructor(
    private kv: KVNamespace,
    private entryLimit: number,
  ) {}

  async list(): Promise<MemoryEntry[]> {
    const { keys } = await this.kv.list({ prefix: KEY_PREFIX })
    const entries = await Promise.all(
      keys.map((k) => this.kv.get<MemoryEntry>(k.name, 'json')),
    )
    return entries.filter((e): e is MemoryEntry => e !== null)
  }

  async put(entry: MemoryEntry): Promise<void> {
    const existing = await this.kv.get(`${KEY_PREFIX}${entry.key}`)
    if (!existing) {
      const currentCount = await this.count()
      if (currentCount >= this.entryLimit) {
        throw new Error('Memory store entry limit reached')
      }
    }

    await this.kv.put(`${KEY_PREFIX}${entry.key}`, JSON.stringify(entry))
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(`${KEY_PREFIX}${key}`)
  }

  async count(): Promise<number> {
    const { keys } = await this.kv.list({ prefix: KEY_PREFIX })
    return keys.length
  }
}
