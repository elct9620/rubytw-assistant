import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIServiceAdapter } from '../../src/adapters/ai-service'
import type { MemoryStore } from '../../src/usecases/ports'
import GROUP_CONVERSATIONS_PROMPT from '../../src/prompts/group-conversations.md'
import GENERATE_ACTION_ITEMS_PROMPT from '../../src/prompts/generate-action-items.md'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: (opts: unknown) => ({ type: 'object', ...opts }),
  },
  tool: (def: unknown) => def,
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}))

function createStubMemoryStore(overrides?: Partial<MemoryStore>): MemoryStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    ...overrides,
  }
}

function createAdapter(overrides?: {
  memoryStore?: MemoryStore
}): AIServiceAdapter {
  return new AIServiceAdapter(
    'test-account-id',
    'test-gateway',
    'test-token',
    'openai/gpt-4.1-mini',
    overrides?.memoryStore ?? createStubMemoryStore(),
    32,
  )
}

describe('AIServiceAdapter', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  describe('groupConversations', () => {
    it('should call generateText with groupConversations output schema and system prompt', async () => {
      mockGenerateText.mockResolvedValue({
        output: {
          groups: [
            {
              topic: '官網',
              summary: '討論改版',
              communityRelated: 'yes',
              smallTalk: 'no',
              lostContext: 'no',
            },
          ],
        },
      })
      const adapter = createAdapter()

      await adapter.groupConversations(['msg-1', 'msg-2'])

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
          output: expect.objectContaining({ type: 'object' }),
          system: GROUP_CONVERSATIONS_PROMPT.replace(
            '{{memoryEntryLimit}}',
            '32',
          ),
          prompt: 'msg-1\nmsg-2',
          temperature: 0.3,
        }),
      )
    })

    it('should return topic groups from AI response', async () => {
      const groups = [
        {
          topic: '官網',
          summary: '討論改版',
          communityRelated: 'yes' as const,
          smallTalk: 'no' as const,
          lostContext: 'no' as const,
        },
      ]
      mockGenerateText.mockResolvedValue({ output: { groups } })
      const adapter = createAdapter()

      const result = await adapter.groupConversations(['msg'])

      expect(result).toEqual(groups)
    })

    it('should throw when output is null', async () => {
      mockGenerateText.mockResolvedValue({ output: null })
      const adapter = createAdapter()

      await expect(adapter.groupConversations(['msg'])).rejects.toThrow(
        'AI service returned no structured output for groupConversations',
      )
    })

    it('should include memory tools when memoryStore is provided', async () => {
      mockGenerateText.mockResolvedValue({
        output: { groups: [] },
      })
      const store = createStubMemoryStore()
      const adapter = createAdapter({ memoryStore: store })

      await adapter.groupConversations(['msg'])

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            memory_read: expect.objectContaining({
              description: expect.stringContaining('Read all memory entries'),
            }),
            memory_write: expect.objectContaining({
              description: expect.stringContaining('Write a memory entry'),
            }),
            memory_delete: expect.objectContaining({
              description: expect.stringContaining('Delete a memory entry'),
            }),
          }),
          stopWhen: expect.objectContaining({
            type: 'stepCount',
            count: 5,
          }),
        }),
      )
    })
  })

  describe('generateActionItems', () => {
    it('should call generateText with generateActionItems output schema and system prompt', async () => {
      mockGenerateText.mockResolvedValue({
        output: {
          items: [
            {
              status: 'to-do',
              description: '更新官網',
              assignee: 'Alice',
              reason: '資訊過舊',
            },
          ],
        },
      })
      const adapter = createAdapter()
      const groups = [
        {
          topic: '官網',
          summary: '討論改版',
          communityRelated: 'yes' as const,
          smallTalk: 'no' as const,
          lostContext: 'no' as const,
        },
      ]

      await adapter.generateActionItems(groups)

      const today = new Date().toISOString().slice(0, 10)
      const expectedSystem = GENERATE_ACTION_ITEMS_PROMPT.replace(
        '{{today}}',
        today,
      ).replace('{{memoryEntryLimit}}', '32')

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
          output: expect.objectContaining({ type: 'object' }),
          system: expectedSystem,
          prompt: JSON.stringify(groups),
          temperature: 0.3,
        }),
      )
    })

    it('should return action items from AI response', async () => {
      const items = [
        {
          status: 'to-do' as const,
          description: '更新官網',
          assignee: 'Alice',
          reason: '資訊過舊',
        },
      ]
      mockGenerateText.mockResolvedValue({ output: { items } })
      const adapter = createAdapter()

      const result = await adapter.generateActionItems([
        {
          topic: '官網',
          summary: '討論改版',
          communityRelated: 'yes',
          smallTalk: 'no',
          lostContext: 'no',
        },
      ])

      expect(result).toEqual(items)
    })

    it('should throw when output is null', async () => {
      mockGenerateText.mockResolvedValue({ output: null })
      const adapter = createAdapter()

      await expect(
        adapter.generateActionItems([
          {
            topic: 't',
            summary: 's',
            communityRelated: 'yes',
            smallTalk: 'no',
            lostContext: 'no',
          },
        ]),
      ).rejects.toThrow(
        'AI service returned no structured output for generateActionItems',
      )
    })

    it('should include memory tools when memoryStore is provided', async () => {
      mockGenerateText.mockResolvedValue({
        output: { items: [] },
      })
      const store = createStubMemoryStore()
      const adapter = createAdapter({ memoryStore: store })

      await adapter.generateActionItems([
        {
          topic: 't',
          summary: 's',
          communityRelated: 'yes',
          smallTalk: 'no',
          lostContext: 'no',
        },
      ])

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            memory_read: expect.anything(),
            memory_write: expect.anything(),
            memory_delete: expect.anything(),
          }),
          stopWhen: expect.objectContaining({ type: 'stepCount', count: 5 }),
        }),
      )
    })
  })

  describe('memory tool execution', () => {
    async function getMemoryTools(storeOverrides?: Partial<MemoryStore>) {
      const store = createStubMemoryStore(storeOverrides)
      mockGenerateText.mockResolvedValue({ output: { groups: [] } })
      const adapter = createAdapter({ memoryStore: store })
      await adapter.groupConversations(['msg'])
      return { tools: mockGenerateText.mock.calls[0][0].tools, store }
    }

    it('memory_read should return entries from store', async () => {
      const entries = [
        {
          key: 'k1',
          content: 'test',
          updatedAt: '2026-03-28T00:00:00.000Z',
        },
      ]
      const { tools } = await getMemoryTools({
        list: vi.fn().mockResolvedValue(entries),
      })

      const result = await tools.memory_read.execute({})
      expect(result).toEqual({ entries, count: 1, limit: 32 })
    })

    it('memory_read should return error object on failure', async () => {
      const { tools } = await getMemoryTools({
        list: vi.fn().mockRejectedValue(new Error('KV error')),
      })

      const result = await tools.memory_read.execute({})
      expect(result.error).toBe('read failed')
      expect(result.entries).toEqual([])
    })

    it('memory_write should call store.put with entry', async () => {
      const { tools, store } = await getMemoryTools()

      const result = await tools.memory_write.execute({
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
      const { tools } = await getMemoryTools({
        put: vi.fn().mockRejectedValue(new Error('limit reached')),
      })

      const result = await tools.memory_write.execute({
        key: 'k',
        content: 'c',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('memory_delete should call store.delete', async () => {
      const { tools, store } = await getMemoryTools()

      const result = await tools.memory_delete.execute({ key: 'old-key' })
      expect(result).toEqual({ success: true })
      expect(store.delete).toHaveBeenCalledWith('old-key')
    })
  })
})
