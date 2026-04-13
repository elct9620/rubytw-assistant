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
  private cachedSlots: StoredSlot[] | null = null

  constructor(
    @inject(TOKENS.MemoryKv) private kv: KVNamespace,
    @inject(TOKENS.MemoryEntryLimit) private entryLimit: number,
    @inject(TOKENS.MemoryDescriptionLimit) private descriptionLimit: number,
  ) {}

  async list(): Promise<MemorySlot[]> {
    const slots = await this.getSlots()
    return slots.map((s, i) => ({ index: i, description: s.description }))
  }

  async read(indices: number[]): Promise<MemorySlotDetail[]> {
    const slots = await this.getSlots()
    return indices.map((i) => {
      const slot = slots[i] ?? { description: '', content: '' }
      return { index: i, description: slot.description, content: slot.content }
    })
  }

  /**
   * Write-through cache: updates the in-memory cache and writes to KV
   * in one step. Cloudflare KV does not guarantee read-after-write
   * consistency, so subsequent reads within the same request must use
   * the cached copy instead of re-fetching from KV.
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

    const slots = await this.getSlots()

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

  /**
   * Returns the cached slots, or fetches from KV on first access.
   * Once cached, all subsequent reads within this adapter instance
   * use the in-memory copy to avoid KV eventual-consistency issues.
   */
  private async getSlots(): Promise<StoredSlot[]> {
    if (this.cachedSlots) {
      return this.cachedSlots
    }

    const { value, metadata } = await this.kv.getWithMetadata<
      StoredSlot[],
      SlotsMetadata
    >(KV_KEY, 'json')

    if (!value && metadata) {
      throw new Error(
        'Memory data missing but metadata exists — refusing to overwrite',
      )
    }

    this.cachedSlots = value ?? emptySlots(this.entryLimit)
    return this.cachedSlots
  }
}
