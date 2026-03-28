import { describe, it, expect, vi } from 'vitest'
import { AIServiceAdapter } from '../../src/adapters/ai-service'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: (opts: unknown) => ({ type: 'object', ...opts }),
  },
}))

describe('AIServiceAdapter', () => {
  describe('groupConversations', () => {
    it('should call generateText with Phase 1 output schema and system prompt', async () => {
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
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

      await adapter.groupConversations(['msg-1', 'msg-2'])

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
          output: expect.objectContaining({ type: 'object' }),
          system: expect.stringContaining('主題分組'),
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
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

      const result = await adapter.groupConversations(['msg'])

      expect(result).toEqual(groups)
    })

    it('should throw when output is null', async () => {
      mockGenerateText.mockResolvedValue({ output: null })
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

      await expect(adapter.groupConversations(['msg'])).rejects.toThrow(
        'AI service returned no structured output for Phase 1',
      )
    })
  })

  describe('generateActionItems', () => {
    it('should call generateText with Phase 2 output schema and system prompt', async () => {
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
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')
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

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
          output: expect.objectContaining({ type: 'object' }),
          system: expect.stringContaining('待辦事項'),
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
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

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
      const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

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
      ).rejects.toThrow('AI service returned no structured output for Phase 2')
    })
  })
})
