import { describe, it, expect, vi } from 'vitest'
import {
  GenerateSummary,
  type GenerateSummaryDeps,
} from '../../src/usecases/generate-summary'
import type { FollowUpItem } from '../../src/entities/follow-up-item'

const sampleItem: FollowUpItem = {
  status: 'to-do',
  description: '寄出贊助報告',
  assignee: 'Kasa',
  lastProgress: '2026-03-30',
  reason: '贊助商等待中',
}

function createStubDeps(
  overrides?: Partial<GenerateSummaryDeps>,
): GenerateSummaryDeps {
  return {
    discord: {
      readMessages: vi
        .fn()
        .mockResolvedValue({ messages: ['msg-1', 'msg-2'], nextCursor: null }),
    },
    followUpAgent: {
      followUp: vi.fn().mockResolvedValue([sampleItem]),
    },
    memorySummaryStore: {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
    },
    memoryAgent: {
      tidyAndSummarize: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  }
}

describe('GenerateSummary', () => {
  it('should hand the collected window to the Follow-up Agent and return its list', async () => {
    const deps = createStubDeps()
    const usecase = new GenerateSummary(deps)

    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'))
    const result = await usecase.execute(24)
    vi.useRealTimers()

    expect(deps.discord.readMessages).toHaveBeenCalledWith({
      since: new Date('2026-03-31T00:00:00Z'),
      limit: 500,
    })
    expect(deps.followUpAgent.followUp).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      undefined,
    )
    expect(result).toEqual({ kind: 'success', items: [sampleItem] })
  })

  it('should run neither agent when no messages were found', async () => {
    const deps = createStubDeps({
      discord: {
        readMessages: vi
          .fn()
          .mockResolvedValue({ messages: [], nextCursor: null }),
      },
    })

    const result = await new GenerateSummary(deps).execute(24)

    expect(result).toEqual({ kind: 'empty' })
    expect(deps.followUpAgent.followUp).not.toHaveBeenCalled()
    expect(deps.memoryAgent.tidyAndSummarize).not.toHaveBeenCalled()
  })

  it('should fall back to raw messages and leave memory alone when the Follow-up Agent fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = createStubDeps({
      followUpAgent: {
        followUp: vi.fn().mockRejectedValue(new Error('token budget exceeded')),
      },
    })

    const result = await new GenerateSummary(deps).execute(24)

    expect(result).toEqual({
      kind: 'fallback',
      rawMessages: ['msg-1', 'msg-2'],
      reason: '[Follow-up Agent] token budget exceeded',
    })
    expect(deps.memoryAgent.tidyAndSummarize).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('should propagate Discord collection errors without fallback', async () => {
    const deps = createStubDeps({
      discord: {
        readMessages: vi.fn().mockRejectedValue(new Error('discord down')),
      },
    })

    await expect(new GenerateSummary(deps).execute(24)).rejects.toThrow(
      'discord down',
    )
  })

  it('should inject the stored memory summary into the Follow-up Agent', async () => {
    const deps = createStubDeps({
      memorySummaryStore: {
        read: vi.fn().mockResolvedValue('previous summary context'),
        write: vi.fn().mockResolvedValue(undefined),
      },
    })

    await new GenerateSummary(deps).execute(24)

    expect(deps.followUpAgent.followUp).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      'previous summary context',
    )
  })

  it('should continue without memory context when the summary store read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memorySummaryStore: {
        read: vi.fn().mockRejectedValue(new Error('KV down')),
        write: vi.fn().mockResolvedValue(undefined),
      },
    })

    const result = await new GenerateSummary(deps).execute(24)

    expect(result.kind).toBe('success')
    expect(deps.followUpAgent.followUp).toHaveBeenCalledWith(
      ['msg-1', 'msg-2'],
      undefined,
    )
    vi.restoreAllMocks()
  })

  it('should run the Memory Agent and store its summary after a successful follow-up', async () => {
    const deps = createStubDeps({
      memoryAgent: {
        tidyAndSummarize: vi.fn().mockResolvedValue('new summary'),
      },
    })

    await new GenerateSummary(deps).execute(24)

    expect(deps.memorySummaryStore.write).toHaveBeenCalledWith('new summary')
  })

  it('should skip the write when the Memory Agent leaves no summary', async () => {
    const deps = createStubDeps()

    await new GenerateSummary(deps).execute(24)

    expect(deps.memoryAgent.tidyAndSummarize).toHaveBeenCalled()
    expect(deps.memorySummaryStore.write).not.toHaveBeenCalled()
  })

  it('should still return the list when the Memory Agent fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memoryAgent: {
        tidyAndSummarize: vi.fn().mockRejectedValue(new Error('AI down')),
      },
    })

    const result = await new GenerateSummary(deps).execute(24)

    expect(result).toEqual({ kind: 'success', items: [sampleItem] })
    expect(deps.memorySummaryStore.write).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('should still return the list when the summary store write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createStubDeps({
      memoryAgent: {
        tidyAndSummarize: vi.fn().mockResolvedValue('new summary'),
      },
      memorySummaryStore: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error('KV write failed')),
      },
    })

    const result = await new GenerateSummary(deps).execute(24)

    expect(result.kind).toBe('success')
    vi.restoreAllMocks()
  })
})
