import { describe, it, expect, vi } from 'vitest'
import { createDebugHandler } from '../../src/handlers/debug'

function createStubs({
  topicGroups = [],
  actionItems = [],
}: {
  topicGroups?: unknown[]
  actionItems?: unknown[]
} = {}) {
  return {
    usecase: {
      execute: vi.fn().mockResolvedValue({ topicGroups, actionItems }),
    },
    defaultHours: 24,
  }
}

describe('debug handler', () => {
  it('should return 400 when channel_id is missing', async () => {
    const app = createDebugHandler(() => createStubs())
    const res = await app.request('/summary')

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
    const stubs = createStubs({ topicGroups, actionItems })
    const app = createDebugHandler(() => stubs)

    const res = await app.request('/summary?channel_id=ch-1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ topicGroups, actionItems })
    expect(stubs.usecase.execute).toHaveBeenCalledWith(24)
  })

  it('should pass channel_id to factory', async () => {
    const factory = vi.fn().mockReturnValue(createStubs())
    const app = createDebugHandler(factory)

    await app.request('/summary?channel_id=my-channel')

    expect(factory.mock.calls[0][1]).toBe('my-channel')
  })

  it('should use custom hours when provided', async () => {
    const stubs = createStubs()
    const app = createDebugHandler(() => stubs)

    await app.request('/summary?channel_id=ch-1&hours=12')

    expect(stubs.usecase.execute).toHaveBeenCalledWith(12)
  })

  it('should return error JSON when use case throws', async () => {
    const stubs = createStubs()
    stubs.usecase.execute.mockRejectedValue(new Error('Discord API failed'))
    const app = createDebugHandler(() => stubs)

    const res = await app.request('/summary?channel_id=ch-1')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Discord API failed' })
  })
})
