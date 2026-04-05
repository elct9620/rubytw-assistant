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
    const slots = await this.loadSlots()
    return slots.map((s, i) => ({ index: i, description: s.description }))
  }

  async read(indices: number[]): Promise<MemorySlotDetail[]> {
    const slots = await this.loadSlots()
    return indices.map((i) => {
      const slot = slots[i] ?? { description: '', content: '' }
      return { index: i, description: slot.description, content: slot.content }
    })
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

    const { value: raw, metadata } = await this.kv.getWithMetadata<
      StoredSlot[]
    >(KV_KEY, 'json')

    if (!raw && metadata) {
      throw new Error(
        'Memory data missing but metadata exists — refusing to overwrite',
      )
    }

    const slots = raw ?? emptySlots(this.entryLimit)

    if (content === '') {
      slots[index] = { description: '', content: '' }
    } else {
      slots[index] = { description, content }
    }

    await this.kv.put(KV_KEY, JSON.stringify(slots), {
      metadata: { updatedAt: new Date().toISOString() },
    })
  }

  private async loadSlots(): Promise<StoredSlot[]> {
    const data = await this.kv.get<StoredSlot[]>(KV_KEY, 'json')
    return data ?? emptySlots(this.entryLimit)
  }
}
