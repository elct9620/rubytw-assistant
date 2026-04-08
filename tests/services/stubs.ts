import { vi } from 'vitest'
import type { GitHubSource } from '../../src/usecases/ports'

export function createStubGitHubSource(
  overrides?: Partial<GitHubSource>,
): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}
