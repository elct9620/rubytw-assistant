import { injectable, inject } from 'tsyringe'
import type { MemoryStore } from '../usecases/ports'
import type { MemoryEntry } from '../entities/memory-entry'
import { TOKENS } from '../tokens'

const KEY_PREFIX = 'memory:'

@injectable()
export class KVMemoryStoreAdapter implements MemoryStore {
  constructor(
    @inject(TOKENS.MemoryKv) private kv: KVNamespace,
    @inject(TOKENS.MemoryEntryLimit) private entryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit) private descriptionLimit: number,
  ) {}

  async list(): Promise<{ index: number; description: string }[]> {
    const slots = await Promise.all(
      Array.from({ length: this.entryLimit }, (_, i) =>
        this.kv.get<MemoryEntry>(`${KEY_PREFIX}${i}`, 'json').then((entry) => ({
          index: i,
          description: entry?.description ?? '',
        })),
      ),
    )
    return slots
  }

  async read(
    indices: number[],
  ): Promise<{ index: number; description: string; content: string }[]> {
    return Promise.all(
      indices.map(async (i) => {
        const entry = await this.kv.get<MemoryEntry>(
          `${KEY_PREFIX}${i}`,
          'json',
        )
        return {
          index: i,
          description: entry?.description ?? '',
          content: entry?.content ?? '',
        }
      }),
    )
  }

  async update(
    index: number,
    description: string,
    content: string,
  ): Promise<void> {
    if (index < 0 || index >= this.entryLimit) {
      throw new Error(`Index ${index} out of range (0..${this.entryLimit - 1})`)
    }

    if (description.length > this.descriptionLimit) {
      throw new Error(
        `Description exceeds ${this.descriptionLimit} character limit`,
      )
    }

    if (content === '') {
      await this.kv.delete(`${KEY_PREFIX}${index}`)
      return
    }

    const entry: MemoryEntry = { description, content }
    await this.kv.put(`${KEY_PREFIX}${index}`, JSON.stringify(entry))
  }
}
