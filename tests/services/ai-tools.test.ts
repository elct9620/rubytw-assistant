import { describe, it, expect, vi } from 'vitest'
import { createAITools } from '../../src/services/ai-tools'
import type { GitHubSource, MemoryStore } from '../../src/usecases/ports'

vi.mock('ai', () => ({
  tool: (def: unknown) => def,
}))

interface MockTool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (...args: unknown[]) => Promise<Record<string, any>>
}

function getTool(tools: Record<string, unknown>, name: string): MockTool {
  return tools[name] as MockTool
}

function createStubMemoryStore(overrides?: Partial<MemoryStore>): MemoryStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    ...overrides,
  }
}

function createStubGitHubSource(
  overrides?: Partial<GitHubSource>,
): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
    getProjectActivities: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function createTools(overrides?: {
  memoryStore?: MemoryStore
  githubSource?: GitHubSource
}) {
  return createAITools({
    memoryStore: overrides?.memoryStore ?? createStubMemoryStore(),
    githubSource: overrides?.githubSource ?? createStubGitHubSource(),
    memoryEntryLimit: 32,
  })
}

describe('createAITools', () => {
  it('should return all expected tool keys', () => {
    const tools = createTools()
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'memory_read',
        'memory_write',
        'memory_delete',
        'github_get_issues',
        'github_get_project_activities',
      ]),
    )
  })

  describe('memory tools', () => {
    it('memory_read should return entries from store', async () => {
      const entries = [
        {
          key: 'k1',
          content: 'test',
          updatedAt: '2026-03-28T00:00:00.000Z',
        },
      ]
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          list: vi.fn().mockResolvedValue(entries),
        }),
      })

      const result = await getTool(tools, 'memory_read').execute({})
      expect(result).toEqual({ entries, count: 1, limit: 32 })
    })

    it('memory_read should return error object on failure', async () => {
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          list: vi.fn().mockRejectedValue(new Error('KV error')),
        }),
      })

      const result = await getTool(tools, 'memory_read').execute({})
      expect(result.error).toBe('read failed')
      expect(result.entries).toEqual([])
    })

    it('memory_write should call store.put with entry', async () => {
      const store = createStubMemoryStore()
      const tools = createTools({ memoryStore: store })

      const result = await getTool(tools, 'memory_write').execute({
        key: 'test-key',
        content: 'test content',
        tag: 'event',
      })
      expect(result).toEqual({ success: true })
      expect(store.put).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'test-key',
          content: 'test content',
          tag: 'event',
          updatedAt: expect.any(String),
        }),
      )
    })

    it('memory_write should return error on failure', async () => {
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          put: vi.fn().mockRejectedValue(new Error('limit reached')),
        }),
      })

      const result = await getTool(tools, 'memory_write').execute({
        key: 'k',
        content: 'c',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('memory_delete should call store.delete', async () => {
      const store = createStubMemoryStore()
      const tools = createTools({ memoryStore: store })

      const result = await getTool(tools, 'memory_delete').execute({
        key: 'old-key',
      })
      expect(result).toEqual({ success: true })
      expect(store.delete).toHaveBeenCalledWith('old-key')
    })
  })

  describe('github tools', () => {
    it('github_get_issues should return issues from source', async () => {
      const issues = ['<issue number="1">Test</issue>']
      const tools = createTools({
        githubSource: createStubGitHubSource({
          getIssues: vi.fn().mockResolvedValue(issues),
        }),
      })

      const result = await getTool(tools, 'github_get_issues').execute({})
      expect(result).toEqual({ issues, count: 1 })
    })

    it('github_get_issues should return error object on failure', async () => {
      const tools = createTools({
        githubSource: createStubGitHubSource({
          getIssues: vi.fn().mockRejectedValue(new Error('auth failed')),
        }),
      })

      const result = await getTool(tools, 'github_get_issues').execute({})
      expect(result.error).toBe('query failed')
      expect(result.issues).toEqual([])
    })

    it('github_get_project_activities should return activities from source', async () => {
      const activities = ['activity-1']
      const tools = createTools({
        githubSource: createStubGitHubSource({
          getProjectActivities: vi.fn().mockResolvedValue(activities),
        }),
      })

      const result = await getTool(
        tools,
        'github_get_project_activities',
      ).execute({})
      expect(result).toEqual({ activities, count: 1 })
    })

    it('github_get_project_activities should return error object on failure', async () => {
      const tools = createTools({
        githubSource: createStubGitHubSource({
          getProjectActivities: vi
            .fn()
            .mockRejectedValue(new Error('rate limit')),
        }),
      })

      const result = await getTool(
        tools,
        'github_get_project_activities',
      ).execute({})
      expect(result.error).toBe('query failed')
      expect(result.activities).toEqual([])
    })
  })
})
