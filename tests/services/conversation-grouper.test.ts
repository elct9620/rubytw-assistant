import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationGrouperService } from '../../src/services/conversation-grouper'
import GROUP_CONVERSATIONS_PROMPT from '../../src/prompts/group-conversations.md'
import { createStubMemoryStore, createStubGitHubSource } from './stubs'
import { nullContext } from '../../src/context'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: (opts: unknown) => ({ type: 'object', ...opts }),
  },
  tool: (def: unknown) => def,
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}))

function createService(): ConversationGrouperService {
  return new ConversationGrouperService(
    {
      accountId: 'test-account-id',
      gatewayId: 'test-gateway',
      apiKey: 'test-token',
      modelId: 'openai/gpt-4.1-mini',
    },
    createStubMemoryStore(),
    32,
    createStubGitHubSource(),
    null,
    nullContext,
  )
}

describe('ConversationGrouperService', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  it('should call generateText with correct system prompt and output schema', async () => {
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
    const service = createService()

    await service.groupConversations(['msg-1', 'msg-2'])

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.anything(),
        output: expect.objectContaining({ type: 'object' }),
        system: GROUP_CONVERSATIONS_PROMPT.replace(
          '{{memoryEntryLimit}}',
          '32',
        ),
        prompt: 'msg-1\nmsg-2',
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
    const service = createService()

    const result = await service.groupConversations(['msg'])

    expect(result).toEqual(groups)
  })

  it('should throw when output is null', async () => {
    mockGenerateText.mockResolvedValue({ output: null })
    const service = createService()

    await expect(service.groupConversations(['msg'])).rejects.toThrow(
      'AI service returned no structured output for groupConversations',
    )
  })

  it('should include memory and github tools', async () => {
    mockGenerateText.mockResolvedValue({
      output: { groups: [] },
    })
    const service = createService()

    await service.groupConversations(['msg'])

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
          github_get_issues: expect.objectContaining({
            description: expect.stringContaining('GitHub Projects V2 issues'),
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
