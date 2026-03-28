import { env, exports } from 'cloudflare:workers'
import {
  createScheduledController,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('fetch handler', () => {
  it('should return hello message', async () => {
    const res = await exports.default.fetch(
      new Request('http://localhost/'),
      env,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })
})

describe('debug summary endpoint', () => {
  it('should return 400 when channel_id is missing', async () => {
    const res = await exports.default.fetch(
      new Request('http://localhost/debug/summary'),
      env,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('channel_id is required')
  })

  // TODO: re-enable once test environment has valid Discord Bot Token
  it.skip('should return JSON result with channel_id', async () => {
    const res = await exports.default.fetch(
      new Request('http://localhost/debug/summary?channel_id=test-channel'),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      topicGroups: unknown[]
      actionItems: unknown[]
    }
    expect(body).toHaveProperty('topicGroups')
    expect(body).toHaveProperty('actionItems')
  })
})

describe('scheduled handler', () => {
  // TODO: re-enable once all adapter stubs are replaced with real implementations
  it.skip('should execute without error', async () => {
    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })
    const ctx = createExecutionContext()

    await exports.default.scheduled(controller, env, ctx)
    await waitOnExecutionContext(ctx)
  })
})
