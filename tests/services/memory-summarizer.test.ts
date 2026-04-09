import { env } from 'cloudflare:workers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemorySummarizerService } from '../../src/services/memory-summarizer'
import { KVMemoryStoreAdapter } from '../../src/adapters/kv-memory-store'
import { KV_KEY } from '../../src/adapters/kv-memory-store'
import SUMMARIZE_MEMORY_PROMPT from '../../src/prompts/summarize-memory.md'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

const LENGTH_LIMIT = 300

function createService(): MemorySummarizerService {
  const memoryStore = new KVMemoryStoreAdapter(env.MEMORY_KV, 4, 128)
  return new MemorySummarizerService(
    {
      accountId: 'test-account-id',
      gatewayId: 'test-gateway',
      apiKey: 'test-token',
      modelId: 'openai/gpt-4.1-mini',
    },
    memoryStore,
    LENGTH_LIMIT,
    null,
  )
}

async function seedSlots(
  slots: Array<{ description: string; content: string }>,
): Promise<void> {
  const padded = Array.from(
    { length: 4 },
    (_, i) => slots[i] ?? { description: '', content: '' },
  )
  await env.MEMORY_KV.put(KV_KEY, JSON.stringify(padded))
}

describe('MemorySummarizerService', () => {
  beforeEach(async () => {
    mockGenerateText.mockReset()
    await env.MEMORY_KV.delete(KV_KEY)
  })

  it('should return null when all slots are empty', async () => {
    const service = createService()
    const result = await service.summarize()
    expect(result).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('should format non-empty slots as Markdown and call AI', async () => {
    await seedSlots([
      { description: 'Active members', content: 'Alice and Bob' },
      { description: '', content: '' },
      { description: 'Ongoing task', content: 'Website redesign' },
    ])
    mockGenerateText.mockResolvedValue({ text: 'condensed summary' })
    const service = createService()

    const result = await service.summarize()

    expect(result).toBe('condensed summary')
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: SUMMARIZE_MEMORY_PROMPT.replace(
          '{{memorySummaryLengthLimit}}',
          '300',
        ),
        prompt: expect.stringContaining('## Slot 0: Active members'),
      }),
    )
    // Should not include empty slot 1
    const call = mockGenerateText.mock.calls[0][0]
    expect(call.prompt).not.toContain('Slot 1')
    expect(call.prompt).toContain('## Slot 2: Ongoing task')
  })

  it('should not pass tools to the AI call', async () => {
    await seedSlots([{ description: 'test', content: 'data' }])
    mockGenerateText.mockResolvedValue({ text: 'summary' })
    const service = createService()

    await service.summarize()

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.tools).toBeUndefined()
  })

  it('should truncate output to length limit', async () => {
    await seedSlots([{ description: 'test', content: 'data' }])
    const longText = 'x'.repeat(500)
    mockGenerateText.mockResolvedValue({ text: longText })
    const service = createService()

    const result = await service.summarize()

    expect(result).toHaveLength(LENGTH_LIMIT)
  })

  it('should propagate AI errors after retries', async () => {
    await seedSlots([{ description: 'test', content: 'data' }])
    mockGenerateText.mockRejectedValue(new Error('AI service down'))
    const service = createService()

    await expect(service.summarize()).rejects.toThrow('AI service down')
  })
})
