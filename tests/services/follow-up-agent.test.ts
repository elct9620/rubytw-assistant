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

const LOOKED_UP: ScriptedCall[] = [
  { toolName: 'list_memories', input: {} },
  { toolName: 'read_memories', input: { indices: [0] } },
  {
    toolName: 'search_messages',
    input: {
      query: '贊助',
      author: 'people',
      involves_self: null,
      since: null,
      until: null,
      cursor: null,
    },
  },
]
const SUBMIT: ScriptedCall = { toolName: 'submit', input: { items: [ITEM] } }

function createService(budget = 1_000) {
  const discordSource = createStubDiscordSource()
  const service = new FollowUpAgentService(
    { gateway: {} as AiGateway, modelId: 'test-model' },
    32,
    budget,
    () =>
      createAITools({
        memoryStore: new KVMemoryStoreAdapter(env.MEMORY_KV, 32, 128),
        githubSource: createStubGitHubSource(),
        discordSource,
        summaryHours: 24,
        memoryEntryLimit: 32,
        memoryDescriptionLimit: 128,
        issueBodyLengthLimit: 500,
      }),
    null,
  )
  return { service, discordSource }
}

describe('FollowUpAgentService', () => {
  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
  })

  it('should return the submitted list once the Goal Check accepts it', async () => {
    model = scriptedModel([LOOKED_UP, [SUBMIT]])
    const { service, discordSource } = createService()

    const items = await service.followUp(['[2026-10-05] Kasa: 報告晚點寄'])

    expect(items).toEqual([ITEM])
    expect(discordSource.searchMessages).toHaveBeenCalledWith(
      expect.objectContaining({ query: '贊助', author: 'people' }),
    )
  })

  it('should keep working after a refused submission and return the list it later hands in', async () => {
    model = scriptedModel([[SUBMIT], LOOKED_UP, [SUBMIT]])
    const { service } = createService()

    const items = await service.followUp(['msg'])

    expect(items).toEqual([ITEM])
  })

  it('should stop at the step that spends the token budget and fail', async () => {
    const scripted = scriptedModel([[SUBMIT]], 400)
    model = scripted
    const { service } = createService(1_000)

    await expect(service.followUp(['msg'])).rejects.toThrow(
      /token budget exceeded/,
    )
    expect(scripted.doGenerateCalls).toHaveLength(3)
  })

  it('should fail a list accepted on the step that went over the token budget', async () => {
    model = scriptedModel([LOOKED_UP, [SUBMIT]], 600)
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

  it('should give the model the collected messages and the stored memory summary', async () => {
    const scripted = scriptedModel([LOOKED_UP, [SUBMIT]])
    model = scripted
    const { service } = createService()

    await service.followUp(['msg-1', 'msg-2'], 'previous summary context')

    const [firstCall] = scripted.doGenerateCalls
    const system = firstCall.prompt.find((m) => m.role === 'system')
    const user = firstCall.prompt.find((m) => m.role === 'user')
    expect(system?.content).toContain('previous summary context')
    expect(JSON.stringify(user?.content)).toContain('msg-1\\nmsg-2')
  })
})
