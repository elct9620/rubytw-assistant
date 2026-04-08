import { env } from 'cloudflare:workers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionItemGeneratorService } from '../../src/services/action-item-generator'
import { createAITools } from '../../src/services/ai-tools'
import GENERATE_ACTION_ITEMS_PROMPT from '../../src/prompts/generate-action-items.md'
import { createStubGitHubSource } from './stubs'
import { KVMemoryStoreAdapter } from '../../src/adapters/kv-memory-store'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: (opts: unknown) => ({ type: 'object', ...opts }),
  },
  NoOutputGeneratedError: {
    isInstance: (error: unknown) =>
      error instanceof Error && error.name === 'AI_NoOutputGeneratedError',
  },
  tool: (def: unknown) => def,
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}))

function createService(): ActionItemGeneratorService {
  const memoryStore = new KVMemoryStoreAdapter(env.MEMORY_KV, 32, 128)
  const githubSource = createStubGitHubSource()
  return new ActionItemGeneratorService(
    {
      accountId: 'test-account-id',
      gatewayId: 'test-gateway',
      apiKey: 'test-token',
      modelId: 'openai/gpt-4.1-mini',
    },
    32,
    () =>
      createAITools({
        memoryStore,
        githubSource,
        memoryEntryLimit: 32,
        memoryDescriptionLimit: 128,
      }),
    null,
  )
}

describe('ActionItemGeneratorService', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  it('should call generateText with correct system prompt and output schema', async () => {
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
    const service = createService()
    const groups = [
      {
        topic: '官網',
        summary: '討論改版',
        communityRelated: 'yes' as const,
        smallTalk: 'no' as const,
        lostContext: 'no' as const,
      },
    ]

    await service.generateActionItems(groups)

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
        providerOptions: { openai: { reasoningEffort: 'low' } },
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
    const service = createService()

    const result = await service.generateActionItems([
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
    const service = createService()

    await expect(
      service.generateActionItems([
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

  it('should catch NoOutputGeneratedError and throw with diagnostic context', async () => {
    const noOutputResult = {
      get output(): never {
        const err = new Error('No output generated.')
        err.name = 'AI_NoOutputGeneratedError'
        throw err
      },
      steps: [{}, {}],
      finishReason: 'tool-calls',
    }
    mockGenerateText.mockResolvedValue(noOutputResult)
    const service = createService()

    await expect(
      service.generateActionItems([
        {
          topic: 't',
          summary: 's',
          communityRelated: 'yes',
          smallTalk: 'no',
          lostContext: 'no',
        },
      ]),
    ).rejects.toThrow(/steps: 2.*finishReason: tool-calls/)
  })

  it('should include memory and github tools', async () => {
    mockGenerateText.mockResolvedValue({
      output: { items: [] },
    })
    const service = createService()

    await service.generateActionItems([
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
          list_memories: expect.anything(),
          read_memories: expect.anything(),
          update_memory: expect.anything(),
          github_get_issues: expect.anything(),
        }),
        stopWhen: expect.objectContaining({ type: 'stepCount', count: 30 }),
      }),
    )
  })
})
