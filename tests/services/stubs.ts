import { vi } from 'vitest'
import type { GitHubSource } from '../../src/usecases/ports'

export function createStubGitHubSource(): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
  }
}
