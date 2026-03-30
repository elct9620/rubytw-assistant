import { vi } from 'vitest'
import type { GitHubSource, MemoryStore } from '../../src/usecases/ports'

export function createStubMemoryStore(): MemoryStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  }
}

export function createStubGitHubSource(): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
  }
}
