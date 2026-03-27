import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import app from '../src/index'

describe('Hono app', () => {
  it('should return hello message', async () => {
    const res = await app.request('/', {}, env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })
})
