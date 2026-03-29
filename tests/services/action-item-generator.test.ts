import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionItemGeneratorService } from '../../src/services/action-item-generator'
import type { GitHubSource, MemoryStore } from '../../src/usecases/ports'
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

function createStubMemoryStore(): MemoryStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
  }
}

function createStubGitHubSource(): GitHubSource {
  return {
    getIssues: vi.fn().mockResolvedValue([]),
    getProjectActivities: vi.fn().mockResolvedValue([]),
  }
}

function createService(): ActionItemGeneratorService {
  return new ActionItemGeneratorService(
    {
      accountId: 'test-account-id',
      gatewayId: 'test-gateway',
      apiKey: 'test-token',
      modelId: 'openai/gpt-4.1-mini',
    },
    createStubMemoryStore(),
    32,
    createStubGitHubSource(),
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
          memory_read: expect.anything(),
          memory_write: expect.anything(),
          memory_delete: expect.anything(),
          github_get_issues: expect.anything(),
          github_get_project_activities: expect.anything(),
        }),
        stopWhen: expect.objectContaining({ type: 'stepCount', count: 5 }),
      }),
    )
  })
})
