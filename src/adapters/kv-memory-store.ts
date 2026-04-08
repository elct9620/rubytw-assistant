import { injectable, inject } from 'tsyringe'
import type {
  MemoryStore,
  MemorySlot,
  MemorySlotDetail,
} from '../usecases/ports'
import { TOKENS } from '../tokens'

interface StoredSlot {
  description: string
  content: string
}

interface SlotsMetadata {
  updatedAt: string
}

export const KV_KEY = 'memory:slots'

function emptySlots(count: number): StoredSlot[] {
  return Array.from({ length: count }, () => ({ description: '', content: '' }))
}

@injectable()
export class KVMemoryStoreAdapter implements MemoryStore {
  constructor(
    @inject(TOKENS.MemoryKv) private kv: KVNamespace,
    @inject(TOKENS.MemoryEntryLimit) private entryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit) private descriptionLimit: number,
  ) {}

  async list(): Promise<MemorySlot[]> {
    const { value } = await this.loadSlots()
    const slots = value ?? emptySlots(this.entryLimit)
    return slots.map((s, i) => ({ index: i, description: s.description }))
  }

  async read(indices: number[]): Promise<MemorySlotDetail[]> {
    const { value } = await this.loadSlots()
    const slots = value ?? emptySlots(this.entryLimit)
    return indices.map((i) => {
      const slot = slots[i] ?? { description: '', content: '' }
      return { index: i, description: slot.description, content: slot.content }
    })
  }

  /**
   * Read-modify-write on a single KV key. KV has no transactions, so
   * concurrent writers can overwrite each other. This assumes a
   * single-writer model — the only writers today are the daily cron
   * and the developer-only debug endpoint, which never run in parallel.
   */
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

    const { value, metadata } = await this.loadSlots()

    if (!value && metadata) {
      throw new Error(
        'Memory data missing but metadata exists — refusing to overwrite',
      )
    }

    const slots = value ?? emptySlots(this.entryLimit)

    if (content === '') {
      slots[index] = { description: '', content: '' }
    } else {
      slots[index] = { description, content }
    }

    const nextMetadata: SlotsMetadata = {
      updatedAt: new Date().toISOString(),
    }
    await this.kv.put(KV_KEY, JSON.stringify(slots), {
      metadata: nextMetadata,
    })
  }

  private async loadSlots(): Promise<{
    value: StoredSlot[] | null
    metadata: SlotsMetadata | null
  }> {
    return this.kv.getWithMetadata<StoredSlot[], SlotsMetadata>(KV_KEY, 'json')
  }
}
