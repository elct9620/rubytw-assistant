import {
  env,
  createScheduledController,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/index'

describe('fetch handler', () => {
  it('should return hello message', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })
})

describe('scheduled handler', () => {
  it('should execute without error', async () => {
    const controller = createScheduledController({
      scheduledTime: Date.now(),
      cron: '0 16 * * *',
    })
    const ctx = createExecutionContext()

    await worker.scheduled(controller, env, ctx)
    await waitOnExecutionContext(ctx)
  })
})
