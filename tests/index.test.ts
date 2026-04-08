import { env, exports } from 'cloudflare:workers'
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
})
