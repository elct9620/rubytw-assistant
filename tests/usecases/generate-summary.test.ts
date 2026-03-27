import { describe, it, expect, vi } from 'vitest'
import {
  GenerateSummary,
  type GenerateSummaryDeps,
} from '../../src/usecases/generate-summary'

function createStubDeps(
  overrides?: Partial<GenerateSummaryDeps>,
): GenerateSummaryDeps {
  return {
    github: {
      getIssues: vi.fn().mockResolvedValue(['issue-1']),
      getProjectActivities: vi.fn().mockResolvedValue(['activity-1']),
    },
    discord: {
      getChannelMessages: vi.fn().mockResolvedValue(['msg-1']),
    },
    ai: {
      generateSummary: vi.fn().mockResolvedValue('AI summary'),
    },
    notifier: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

describe('GenerateSummary', () => {
  it('should collect data from all sources and send AI summary', async () => {
    const deps = createStubDeps()
    const usecase = new GenerateSummary(deps)

    await usecase.execute('channel-123', 24)

    expect(deps.discord.getChannelMessages).toHaveBeenCalledWith(24)
    expect(deps.ai.generateSummary).toHaveBeenCalledWith(
      'issue-1\nactivity-1\nmsg-1',
    )
    expect(deps.notifier.sendMessage).toHaveBeenCalledWith(
      'channel-123',
      'AI summary',
    )
  })

  it('should collect GitHub and Discord data in parallel', async () => {
    const order: string[] = []
    const deps = createStubDeps({
      github: {
        getIssues: vi.fn().mockImplementation(async () => {
          order.push('issues')
          return []
        }),
        getProjectActivities: vi.fn().mockImplementation(async () => {
          order.push('activities')
          return []
        }),
      },
      discord: {
        getChannelMessages: vi.fn().mockImplementation(async () => {
          order.push('messages')
          return []
        }),
      },
    })
    const usecase = new GenerateSummary(deps)

    await usecase.execute('ch', 12)

    expect(order).toContain('issues')
    expect(order).toContain('activities')
    expect(order).toContain('messages')
  })
})
