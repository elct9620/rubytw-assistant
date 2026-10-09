import { env } from 'cloudflare:workers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { MemoryAgentService } from '../../src/services/memory-agent'
import {
  KVMemoryStoreAdapter,
  KV_KEY,
} from '../../src/adapters/kv-memory-store'
import { scriptedModel } from '../helpers/scripted-model'

let model: LanguageModel
vi.mock('../../src/services/ai-model', () => ({
  createAIModel: () => model,
}))

const ENTRY_LIMIT = 4
const LENGTH_LIMIT = 300

function createService() {
  const memoryStore = new KVMemoryStoreAdapter(env.MEMORY_KV, ENTRY_LIMIT, 128)
  const service = new MemoryAgentService(
    { gateway: {} as AiGateway, modelId: 'test-model' },
    memoryStore,
    ENTRY_LIMIT,
    128,
    LENGTH_LIMIT,
    [],
  )
  return { service, memoryStore }
}

async function seedSlots(
  slots: Array<{ description: string; content: string }>,
): Promise<void> {
  const padded = Array.from(
    { length: ENTRY_LIMIT },
    (_, i) => slots[i] ?? { description: '', content: '' },
  )
  await env.MEMORY_KV.put(KV_KEY, JSON.stringify(padded))
}

const brief = (summary: string) => [{ toolName: 'submit', input: { summary } }]
const BRIEF = brief('Kasa 負責宣傳。')

const READ_ALL = [
  { toolName: 'list_memories', input: {} },
  { toolName: 'read_memories', input: { indices: [0, 1] } },
]

describe('MemoryAgentService', () => {
  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
  })

  it('should not call the model when memory is empty', async () => {
    const scripted = scriptedModel(['unused'])
    model = scripted

    const result = await createService().service.tidyAndSummarize()

    expect(result).toBeNull()
    expect(scripted.doGenerateCalls).toHaveLength(0)
  })

  it('should let the agent clear a slot and return the briefing it submits', async () => {
    await seedSlots([
      { description: 'Kasa: RT organizer', content: 'Handles promotion' },
      { description: '車輪餅團購', content: '2026-05-08: 待分發' },
    ])
    model = scriptedModel([
      READ_ALL,
      [
        {
          toolName: 'update_memory',
          input: { index: 1, description: '', content: '' },
        },
      ],
      BRIEF,
    ])
    const { service, memoryStore } = createService()

    const result = await service.tidyAndSummarize()

    expect(result).toBe('Kasa 負責宣傳。')
    const slots = await memoryStore.list()
    expect(slots.map((slot) => slot.description)).toEqual([
      'Kasa: RT organizer',
      '',
      '',
      '',
    ])
  })

  it('should offer the agent the memory tools and submit only', async () => {
    await seedSlots([{ description: 'Kasa', content: 'organizer' }])
    const scripted = scriptedModel([BRIEF])
    model = scripted

    await createService().service.tidyAndSummarize()

    const tools = (scripted.doGenerateCalls[0].tools ?? []).map((t) => t.name)
    expect(tools.sort()).toEqual([
      'list_memories',
      'read_memories',
      'submit',
      'update_memory',
    ])
  })

  it('should give the agent instructions with every placeholder filled', async () => {
    await seedSlots([{ description: 'Kasa', content: 'organizer' }])
    const scripted = scriptedModel([BRIEF])
    model = scripted

    await createService().service.tidyAndSummarize()

    const system = scripted.doGenerateCalls[0].prompt.find(
      (m) => m.role === 'system',
    )
    expect(system?.content).not.toMatch(/\{\{\w+\}\}/)
  })

  it('should date the run in Taiwan, where the midnight cron is already the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T16:00:30Z'))
    await seedSlots([{ description: 'Kasa', content: 'organizer' }])
    const scripted = scriptedModel([BRIEF])
    model = scripted

    await createService().service.tidyAndSummarize()
    vi.useRealTimers()

    const system = scripted.doGenerateCalls[0].prompt.find(
      (m) => m.role === 'system',
    )
    expect(system?.content).toContain('Today is 2026-10-09.')
  })

  it('should return null when tidying leaves memory empty', async () => {
    await seedSlots([{ description: '舊任務', content: '2026-01-01: 已完成' }])
    model = scriptedModel([
      [
        { toolName: 'list_memories', input: {} },
        { toolName: 'read_memories', input: { indices: [0] } },
      ],
      [
        {
          toolName: 'update_memory',
          input: { index: 0, description: '', content: '' },
        },
      ],
      BRIEF,
    ])

    const result = await createService().service.tidyAndSummarize()

    expect(result).toBeNull()
  })

  it('should refuse an over-long briefing and return the shorter one submitted next', async () => {
    await seedSlots([{ description: 'Kasa', content: 'organizer' }])
    const scripted = scriptedModel([
      brief('字'.repeat(LENGTH_LIMIT + 1)),
      brief('字'.repeat(LENGTH_LIMIT)),
    ])
    model = scripted

    const result = await createService().service.tidyAndSummarize()

    expect(result).toBe('字'.repeat(LENGTH_LIMIT))
    expect(scripted.doGenerateCalls).toHaveLength(2)
  })

  it('should fail when the step cap is reached without an accepted briefing', async () => {
    await seedSlots([{ description: 'Kasa', content: 'organizer' }])
    model = scriptedModel([brief('字'.repeat(LENGTH_LIMIT + 1))])

    await expect(createService().service.tidyAndSummarize()).rejects.toThrow(
      /without an accepted summary/,
    )
  })
})
