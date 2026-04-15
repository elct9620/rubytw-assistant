import { env } from 'cloudflare:workers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAITools } from '../../src/services/ai-tools'
import type { GitHubSource, MemoryStore } from '../../src/usecases/ports'
import {
  KVMemoryStoreAdapter,
  KV_KEY,
} from '../../src/adapters/kv-memory-store'
import { createStubGitHubSource } from './stubs'

vi.mock('ai', () => ({
  tool: (def: unknown) => def,
}))

import { z } from 'zod'

interface MockTool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (...args: unknown[]) => Promise<Record<string, any>>
  inputSchema: z.ZodTypeAny
}

function getTool(tools: Record<string, unknown>, name: string): MockTool {
  return tools[name] as MockTool
}

const ENTRY_LIMIT = 32
const DESCRIPTION_LIMIT = 128

function createMemoryStore(): KVMemoryStoreAdapter {
  return new KVMemoryStoreAdapter(env.MEMORY_KV, ENTRY_LIMIT, DESCRIPTION_LIMIT)
}

function createTools(overrides?: {
  memoryStore?: MemoryStore
  githubSource?: GitHubSource
  issueBodyLengthLimit?: number
}) {
  return createAITools({
    memoryStore: overrides?.memoryStore ?? createMemoryStore(),
    githubSource: overrides?.githubSource ?? createStubGitHubSource(),
    memoryEntryLimit: ENTRY_LIMIT,
    memoryDescriptionLimit: DESCRIPTION_LIMIT,
    issueBodyLengthLimit: overrides?.issueBodyLengthLimit ?? 500,
  })
}

describe('createAITools', () => {
  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
  })

  it('should return all expected tool keys', () => {
    const tools = createTools()
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'list_memories',
        'read_memories',
        'update_memory',
        'list_issues',
        'read_issues',
      ]),
    )
  })

  describe('memory tools', () => {
    it('list_memories should return slots from store', async () => {
      const stored = [
        { description: 'ongoing tasks', content: 'details' },
        { description: '', content: '' },
      ]
      await env.MEMORY_KV.put(KV_KEY, JSON.stringify(stored))

      const tools = createTools()
      const result = await getTool(tools, 'list_memories').execute({})
      expect(result).toEqual({
        slots: [
          { index: 0, description: 'ongoing tasks' },
          { index: 1, description: '' },
        ],
        limit: ENTRY_LIMIT,
      })
    })

    it('list_memories should return error object on failure', async () => {
      const tools = createTools({
        memoryStore: {
          list: vi.fn().mockRejectedValue(new Error('KV error')),
          read: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue(undefined),
        },
      })

      const result = await getTool(tools, 'list_memories').execute({})
      expect(result.error).toBe('list failed')
      expect(result.slots).toEqual([])
    })

    it('read_memories should return entries for requested indices', async () => {
      const stored = [{ description: 'ongoing tasks', content: 'task details' }]
      await env.MEMORY_KV.put(KV_KEY, JSON.stringify(stored))

      const tools = createTools()
      const result = await getTool(tools, 'read_memories').execute({
        indices: [0],
      })
      expect(result).toEqual({
        entries: [
          { index: 0, description: 'ongoing tasks', content: 'task details' },
        ],
      })
    })

    it('read_memories should return error object on failure', async () => {
      const tools = createTools({
        memoryStore: {
          list: vi.fn().mockResolvedValue([]),
          read: vi.fn().mockRejectedValue(new Error('KV error')),
          update: vi.fn().mockResolvedValue(undefined),
        },
      })

      const result = await getTool(tools, 'read_memories').execute({
        indices: [0],
      })
      expect(result.error).toBe('read failed')
      expect(result.entries).toEqual([])
    })

    it('update_memory should persist data after reading the same index', async () => {
      const tools = createTools()

      await getTool(tools, 'read_memories').execute({ indices: [0] })
      const result = await getTool(tools, 'update_memory').execute({
        index: 0,
        description: 'test slot',
        content: 'test content',
      })
      expect(result).toEqual({ success: true })

      const store = createMemoryStore()
      const entries = await store.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'test slot',
        content: 'test content',
      })
    })

    it('update_memory should reject when index was not read first', async () => {
      const tools = createTools()

      const result = await getTool(tools, 'update_memory').execute({
        index: 3,
        description: 'test',
        content: 'content',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'must read_memories for index 3 before updating',
      )
    })

    it('update_memory should reject when a different index was read', async () => {
      const tools = createTools()

      await getTool(tools, 'read_memories').execute({ indices: [0] })
      const result = await getTool(tools, 'update_memory').execute({
        index: 1,
        description: 'test',
        content: 'content',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'must read_memories for index 1 before updating',
      )
    })

    it('update_memory should reject when read_memories failed for the same index', async () => {
      const tools = createTools({
        memoryStore: {
          list: vi.fn().mockResolvedValue([]),
          read: vi.fn().mockRejectedValue(new Error('KV error')),
          update: vi.fn().mockResolvedValue(undefined),
        },
      })

      await getTool(tools, 'read_memories').execute({ indices: [2] })
      const result = await getTool(tools, 'update_memory').execute({
        index: 2,
        description: 'test',
        content: 'content',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'must read_memories for index 2 before updating',
      )
    })

    it('update_memory should allow updating multiple indices after batch read', async () => {
      const tools = createTools()

      await getTool(tools, 'read_memories').execute({ indices: [0, 2, 5] })
      const r1 = await getTool(tools, 'update_memory').execute({
        index: 0,
        description: 'slot 0',
        content: 'content 0',
      })
      const r2 = await getTool(tools, 'update_memory').execute({
        index: 5,
        description: 'slot 5',
        content: 'content 5',
      })
      expect(r1).toEqual({ success: true })
      expect(r2).toEqual({ success: true })

      const store = createMemoryStore()
      const entries = await store.read([0, 5])
      expect(entries).toEqual([
        { index: 0, description: 'slot 0', content: 'content 0' },
        { index: 5, description: 'slot 5', content: 'content 5' },
      ])
    })

    it('update_memory should return error on failure', async () => {
      const tools = createTools({
        memoryStore: {
          list: vi.fn().mockResolvedValue([]),
          read: vi.fn().mockImplementation((indices: number[]) =>
            Promise.resolve(
              indices.map((i) => ({
                index: i,
                description: '',
                content: '',
              })),
            ),
          ),
          update: vi
            .fn()
            .mockRejectedValue(new Error('Index 99 out of range (0..31)')),
        },
      })

      await getTool(tools, 'read_memories').execute({ indices: [99] })
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
    it('list_issues should return issues from source', async () => {
      const issues = [
        {
          title: 'Test',
          number: 1,
          state: 'OPEN',
          url: 'u',
          labels: [],
          assignees: [],
          status: null,
        },
      ]
      const tools = createTools({
        githubSource: createStubGitHubSource({
          listIssues: vi.fn().mockResolvedValue(issues),
        }),
      })

      const result = await getTool(tools, 'list_issues').execute({})
      expect(result).toEqual({ issues, count: 1 })
    })

    it('list_issues should return error object on failure', async () => {
      const tools = createTools({
        githubSource: createStubGitHubSource({
          listIssues: vi.fn().mockRejectedValue(new Error('auth failed')),
        }),
      })

      const result = await getTool(tools, 'list_issues').execute({})
      expect(result.error).toBe('query failed')
      expect(result.issues).toEqual([])
    })

    it('list_issues should pass state to source', async () => {
      const listIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ listIssues }),
      })

      await getTool(tools, 'list_issues').execute({
        state: 'OPEN',
      })
      expect(listIssues).toHaveBeenCalledWith('OPEN')
    })

    it('list_issues should pass undefined when no params given', async () => {
      const listIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ listIssues }),
      })

      await getTool(tools, 'list_issues').execute({})
      expect(listIssues).toHaveBeenCalledWith(undefined)
    })

    it('read_issues should return issue details from source', async () => {
      const issues = [
        {
          number: 1,
          title: 'Test',
          state: 'OPEN',
          url: 'u',
          body: 'body text',
          labels: [],
          assignees: [],
          status: null,
        },
      ]
      const tools = createTools({
        githubSource: createStubGitHubSource({
          readIssues: vi.fn().mockResolvedValue(issues),
        }),
      })

      const result = await getTool(tools, 'read_issues').execute({
        numbers: [1],
      })
      expect(result).toEqual({ issues, count: 1 })
    })

    it('read_issues should return error object on failure', async () => {
      const tools = createTools({
        githubSource: createStubGitHubSource({
          readIssues: vi.fn().mockRejectedValue(new Error('auth failed')),
        }),
      })

      const result = await getTool(tools, 'read_issues').execute({
        numbers: [1],
      })
      expect(result.error).toBe('query failed')
      expect(result.issues).toEqual([])
    })

    it('read_issues should pass numbers and body limit to source', async () => {
      const readIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ readIssues }),
      })

      await getTool(tools, 'read_issues').execute({ numbers: [1, 2] })
      expect(readIssues).toHaveBeenCalledWith([1, 2], 500)
    })

    it('list_issues should pass CLOSED state to source', async () => {
      const listIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ listIssues }),
      })

      await getTool(tools, 'list_issues').execute({ state: 'CLOSED' })
      expect(listIssues).toHaveBeenCalledWith('CLOSED')
    })

    it('list_issues schema should reject invalid state value', () => {
      const tools = createTools()
      const schema = getTool(tools, 'list_issues').inputSchema
      const result = schema.safeParse({ state: 'INVALID' })
      expect(result.success).toBe(false)
    })

    it('read_issues schema should reject empty numbers array', () => {
      const tools = createTools()
      const schema = getTool(tools, 'read_issues').inputSchema
      const result = schema.safeParse({ numbers: [] })
      expect(result.success).toBe(false)
    })

    it('read_issues schema should reject numbers array with more than 10 items', () => {
      const tools = createTools()
      const schema = getTool(tools, 'read_issues').inputSchema
      const result = schema.safeParse({
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      })
      expect(result.success).toBe(false)
    })

    it('read_issues schema should reject non-positive numbers', () => {
      const tools = createTools()
      const schema = getTool(tools, 'read_issues').inputSchema
      const result = schema.safeParse({ numbers: [-1] })
      expect(result.success).toBe(false)
    })

    it('read_issues schema should reject non-integer numbers', () => {
      const tools = createTools()
      const schema = getTool(tools, 'read_issues').inputSchema
      const result = schema.safeParse({ numbers: [1.5] })
      expect(result.success).toBe(false)
    })

    it('read_issues should pass custom issueBodyLengthLimit to source', async () => {
      const readIssues = vi.fn().mockResolvedValue([])
      const tools = createTools({
        githubSource: createStubGitHubSource({ readIssues }),
        issueBodyLengthLimit: 42,
      })

      await getTool(tools, 'read_issues').execute({ numbers: [1] })
      expect(readIssues).toHaveBeenCalledWith([1], 42)
    })
  })
})
