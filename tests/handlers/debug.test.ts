import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { PreviewSummary } from '../../src/usecases/preview-summary'
import debug from '../../src/handlers/debug'

const mockExecute = vi.fn()

beforeEach(() => {
  container.clearInstances()

  container.register(TOKENS.ConversationGrouper, {
    useValue: {},
  })
  container.register(TOKENS.ActionItemGenerator, {
    useValue: {},
  })
  container.register(TOKENS.DiscordSource, {
    useValue: {},
  })
  container.register(PreviewSummary, {
    useFactory: () => ({ execute: mockExecute }),
  })

  mockExecute.mockReset()
})

describe('debug handler', () => {
  it('should return 400 when channel_id is missing', async () => {
    const res = await debug.request('/summary')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('should return topic groups and action items as JSON', async () => {
    const topicGroups = [
      {
        topic: 'Test',
        summary: 'Test summary',
        communityRelated: 'yes',
        smallTalk: 'no',
        lostContext: 'no',
      },
    ]
    const actionItems = [
      {
        status: 'to-do',
        description: 'Do thing',
        assignee: 'Bob',
        reason: 'Needed',
      },
    ]
    mockExecute.mockResolvedValue({ topicGroups, actionItems })

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ topicGroups, actionItems })
    expect(mockExecute).toHaveBeenCalled()
  })

  it('should use custom hours when provided', async () => {
    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })

    await debug.request('/summary?channel_id=ch-1&hours=12', {
      SUMMARY_HOURS: '24',
    })

    expect(mockExecute).toHaveBeenCalledWith(12)
  })

  it('should return error JSON when use case throws', async () => {
    mockExecute.mockRejectedValue(new Error('Discord API failed'))

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Discord API failed' })
  })
})
