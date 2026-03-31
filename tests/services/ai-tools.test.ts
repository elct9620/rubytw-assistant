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
    read: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createStubGitHubSource(
  overrides?: Partial<GitHubSource>,
): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
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
    memoryDescriptionLimit: 128,
  })
}

describe('createAITools', () => {
  it('should return all expected tool keys', () => {
    const tools = createTools()
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'list_memories',
        'read_memories',
        'update_memory',
        'github_get_issues',
      ]),
    )
  })

  describe('memory tools', () => {
    it('list_memories should return slots from store', async () => {
      const slots = [
        { index: 0, description: 'ongoing tasks' },
        { index: 1, description: '' },
      ]
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          list: vi.fn().mockResolvedValue(slots),
        }),
      })

      const result = await getTool(tools, 'list_memories').execute({})
      expect(result).toEqual({ slots, limit: 32 })
    })

    it('list_memories should return error object on failure', async () => {
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          list: vi.fn().mockRejectedValue(new Error('KV error')),
        }),
      })

      const result = await getTool(tools, 'list_memories').execute({})
      expect(result.error).toBe('list failed')
      expect(result.slots).toEqual([])
    })

    it('read_memories should return entries for requested indices', async () => {
      const entries = [
        { index: 0, description: 'ongoing tasks', content: 'task details' },
      ]
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          read: vi.fn().mockResolvedValue(entries),
        }),
      })

      const result = await getTool(tools, 'read_memories').execute({
        indices: [0],
      })
      expect(result).toEqual({ entries })
    })

    it('read_memories should return error object on failure', async () => {
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          read: vi.fn().mockRejectedValue(new Error('KV error')),
        }),
      })

      const result = await getTool(tools, 'read_memories').execute({
        indices: [0],
      })
      expect(result.error).toBe('read failed')
      expect(result.entries).toEqual([])
    })

    it('update_memory should call store.update', async () => {
      const store = createStubMemoryStore()
      const tools = createTools({ memoryStore: store })

      const result = await getTool(tools, 'update_memory').execute({
        index: 0,
        description: 'test slot',
        content: 'test content',
      })
      expect(result).toEqual({ success: true })
      expect(store.update).toHaveBeenCalledWith(0, 'test slot', 'test content')
    })

    it('update_memory should return error on failure', async () => {
      const tools = createTools({
        memoryStore: createStubMemoryStore({
          update: vi
            .fn()
            .mockRejectedValue(new Error('Index 99 out of range (0..31)')),
        }),
      })

      const result = await getTool(tools, 'update_memory').execute({
        index: 99,
        description: 'd',
        content: 'c',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Index 99 out of range (0..31)')
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

    it('github_get_issues should pass filter to source', async () => {
      const getIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ getIssues }),
      })

      await getTool(tools, 'github_get_issues').execute({
        state: 'OPEN',
      })
      expect(getIssues).toHaveBeenCalledWith({
        state: 'OPEN',
      })
    })

    it('github_get_issues should pass empty filter when no params given', async () => {
      const getIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ getIssues }),
      })

      await getTool(tools, 'github_get_issues').execute({})
      expect(getIssues).toHaveBeenCalledWith({})
    })
  })
})
