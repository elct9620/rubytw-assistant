import { vi } from 'vitest'
import type { GitHubSource, MemoryStore } from '../../src/usecases/ports'

export function createStubMemoryStore(): MemoryStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
  }
}

export function createStubGitHubSource(): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
  }
}
