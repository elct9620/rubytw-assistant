import { vi } from 'vitest'
import type { GitHubSource } from '../../src/usecases/ports'

export function createStubGitHubSource(
  overrides?: Partial<GitHubSource>,
): GitHubSource {
  return {
    listIssues: vi.fn().mockResolvedValue([]),
    readIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}
