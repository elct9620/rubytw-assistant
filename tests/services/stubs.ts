import { vi } from 'vitest'
import type { DiscordSource, GitHubSource } from '../../src/usecases/ports'

export function createStubGitHubSource(
  overrides?: Partial<GitHubSource>,
): GitHubSource {
  return {
    listIssues: vi.fn().mockResolvedValue([]),
    readIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

export function createStubDiscordSource(
  overrides?: Partial<DiscordSource>,
): DiscordSource {
  return {
    readMessages: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
    ...overrides,
  }
}
