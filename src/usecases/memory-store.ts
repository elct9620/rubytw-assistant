import type { MemoryEntry } from '../entities/memory-entry'

export interface MemoryStore {
  list(): Promise<MemoryEntry[]>
  put(entry: MemoryEntry): Promise<void>
  delete(key: string): Promise<void>
  count(): Promise<number>
}
