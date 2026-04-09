import { injectable, inject } from 'tsyringe'
import type { MemorySummaryStore } from '../usecases/ports'
import { TOKENS } from '../tokens'

export const KV_KEY = 'memory:summary'

@injectable()
export class KVMemorySummaryStoreAdapter implements MemorySummaryStore {
  constructor(@inject(TOKENS.MemoryKv) private kv: KVNamespace) {}

  async read(): Promise<string | null> {
    return this.kv.get(KV_KEY, 'text')
  }

  async write(summary: string): Promise<void> {
    await this.kv.put(KV_KEY, summary)
  }
}
