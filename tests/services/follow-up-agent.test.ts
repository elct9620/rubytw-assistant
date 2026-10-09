import { env } from 'cloudflare:workers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { FollowUpAgentService } from '../../src/services/follow-up-agent'
import { createAITools } from '../../src/services/ai-tools'
import {
  KVMemoryStoreAdapter,
  KV_KEY,
} from '../../src/adapters/kv-memory-store'
import { createStubDiscordSource, createStubGitHubSource } from './stubs'
import { scriptedModel, type ScriptedCall } from '../helpers/scripted-model'

let model: LanguageModel
vi.mock('../../src/services/ai-model', () => ({
  createAIModel: () => model,
}))

const ITEM = {
  status: 'stalled',
  description: '寄出贊助報告',
  assignee: 'Kasa',
  lastProgress: '2026-09-20',
  reason: '兩週無人提起',
}
const KASA_PROMISE = {
  id: '100',
  text: '贊助報告我晚點寄',
  timestamp: '2026-09-20T03:00:00.000Z',
  fromSelf: false,
}
const EVIDENCED = {
  ...ITEM,
  evidence: [{ type: 'message', id: '100', quote: '贊助報告我晚點寄' }],
}

const LOOKED_UP: ScriptedCall[] = [
  { toolName: 'list_memories', input: {} },
  { toolName: 'read_memories', input: { indices: [0] } },
]
const SUBMIT: ScriptedCall = {
  toolName: 'submit',
  input: { items: [EVIDENCED] },
}
/** The relevance judge's answer, which the submission's check asks the same model for. */
const RELEVANT = JSON.stringify({
  verdicts: [{ item: 1, relevant: true, reason: '' }],
})
/** Refused: its last progress is not the date of its evidence. */
const MISDATED: ScriptedCall = {
  toolName: 'submit',
  input: { items: [{ ...EVIDENCED, lastProgress: '2026-10-01' }] },
}

function createService(budget = 1_000) {
  const service = new FollowUpAgentService(
    { gateway: {} as AiGateway, modelId: 'test-model' },
    32,
    budget,
    () =>
      createAITools({
        memoryStore: new KVMemoryStoreAdapter(env.MEMORY_KV, 32, 128),
        githubSource: createStubGitHubSource(),
        discordSource: createStubDiscordSource(),
        summaryHours: 24,
        memoryEntryLimit: 32,
        memoryDescriptionLimit: 128,
        issueBodyLengthLimit: 500,
      }),
    createStubDiscordSource({
      readMessage: vi.fn().mockResolvedValue(KASA_PROMISE),
    }),
    createStubGitHubSource(),
    [],
  )
  return { service }
}

describe('FollowUpAgentService', () => {
  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
  })

  it('should return the submitted list, without its evidence, once the Evidence Check accepts it', async () => {
    model = scriptedModel([LOOKED_UP, [SUBMIT], RELEVANT])
    const { service } = createService()

    const items = await service.followUp(['[2026-10-05] Kasa: 報告晚點寄'])

    expect(items).toEqual([ITEM])
  })

  it('should hand back an item the agent abandoned this run', async () => {
    const abandoned = { status: 'abandoned', reason: '提醒後一週仍無進展' }
    model = scriptedModel([
      LOOKED_UP,
      [
        {
          toolName: 'submit',
          input: { items: [{ ...EVIDENCED, ...abandoned }] },
        },
      ],
      RELEVANT,
    ])
    const { service } = createService()

    const items = await service.followUp(['msg'])

    expect(items).toEqual([{ ...ITEM, ...abandoned }])
  })

  it('should keep working after a refused submission and return the list it later hands in', async () => {
    model = scriptedModel([[MISDATED], LOOKED_UP, [SUBMIT], RELEVANT])
    const { service } = createService()

    const items = await service.followUp(['msg'])

    expect(items).toEqual([ITEM])
  })

  it('should stop at the step that spends the token budget and fail', async () => {
    const scripted = scriptedModel([[MISDATED]], 400)
    model = scripted
    const { service } = createService(1_000)

    await expect(service.followUp(['msg'])).rejects.toThrow(
      /token budget exceeded/,
    )
    expect(scripted.doGenerateCalls).toHaveLength(3)
  })

  it('should fail a list accepted on the step that went over the token budget', async () => {
    model = scriptedModel([LOOKED_UP, [SUBMIT], RELEVANT], 600)
    const { service } = createService(1_000)

    await expect(service.followUp(['msg'])).rejects.toThrow(
      /token budget exceeded/,
    )
  })

  it('should fail when the step cap is reached without an accepted list', async () => {
    const scripted = scriptedModel(
      [[{ toolName: 'list_memories', input: {} }]],
      1,
    )
    model = scripted
    const { service } = createService(1_000_000)

    await expect(service.followUp(['msg'])).rejects.toThrow(
      /without an accepted list/,
    )
    expect(scripted.doGenerateCalls).toHaveLength(50)
  })

  it('should date the run in Taiwan, where the midnight cron is already the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T16:00:30Z'))
    const scripted = scriptedModel([LOOKED_UP, [SUBMIT], RELEVANT])
    model = scripted

    await createService().service.followUp(['msg'])
    vi.useRealTimers()

    const system = scripted.doGenerateCalls[0].prompt.find(
      (m) => m.role === 'system',
    )
    expect(system?.content).toContain('Today is 2026-10-09 in Taiwan.')
  })

  it('should give the model the collected messages and the stored memory summary', async () => {
    const scripted = scriptedModel([LOOKED_UP, [SUBMIT], RELEVANT])
    model = scripted
    const { service } = createService()

    await service.followUp(['msg-1', 'msg-2'], 'previous summary context')

    const [firstCall] = scripted.doGenerateCalls
    const system = firstCall.prompt.find((m) => m.role === 'system')
    const user = firstCall.prompt.find((m) => m.role === 'user')
    expect(system?.content).toContain('previous summary context')
    expect(system?.content).not.toMatch(/\{\{\w+\}\}/)
    expect(JSON.stringify(user?.content)).toContain('msg-1\\nmsg-2')
  })
})
