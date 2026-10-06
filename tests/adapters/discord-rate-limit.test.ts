import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi } from 'vitest'
import { DiscordSourceAdapter } from '../../src/adapters/discord-source'
import { RateLimitedError } from '../../src/usecases/ports'
import { network } from '../msw-server'

const SEARCH_URL = 'https://discord.com/api/v10/guilds/guild-1/messages/search'

const newAdapter = () =>
  new DiscordSourceAdapter('bot-token', 'channel-123', 'assistant-1', 'guild-1')

const emptyHits = (headers: Record<string, string> = {}) =>
  HttpResponse.json({ total_results: 0, messages: [] }, { headers })

describe('Discord rate limit pacing', () => {
  it('should send requests issued together one at a time, waiting while the limit is spent', async () => {
    const started: number[] = []
    let inFlight = 0
    let maxInFlight = 0
    network.use(
      http.get(SEARCH_URL, async () => {
        started.push(Date.now())
        maxInFlight = Math.max(maxInFlight, ++inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight--
        return emptyHits({
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset-After': '0.2',
        })
      }),
    )
    const adapter = newAdapter()

    await Promise.all([
      adapter.searchMessages({ query: 'a' }),
      adapter.searchMessages({ query: 'b' }),
      adapter.searchMessages({ query: 'c' }),
    ])

    expect(maxInFlight).toBe(1)
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(190)
    expect(started[2] - started[1]).toBeGreaterThanOrEqual(190)
  })

  it('should not wait while the limit still has room', async () => {
    const started: number[] = []
    network.use(
      http.get(SEARCH_URL, () => {
        started.push(Date.now())
        return emptyHits({
          'X-RateLimit-Remaining': '4',
          'X-RateLimit-Reset-After': '5',
        })
      }),
    )
    const adapter = newAdapter()

    await adapter.searchMessages({ query: 'a' })
    await adapter.searchMessages({ query: 'b' })

    expect(started[1] - started[0]).toBeLessThan(1000)
  })

  it('should wait out a refusal for the time Discord names, then retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const started: number[] = []
    network.use(
      http.get(SEARCH_URL, () => {
        started.push(Date.now())
        return started.length === 1
          ? HttpResponse.json(
              { message: 'You are being rate limited.', retry_after: 0.3 },
              { status: 429, headers: { 'Retry-After': '0.3' } },
            )
          : emptyHits()
      }),
    )

    const page = await newAdapter().searchMessages({ query: 'a' })

    expect(page.total).toBe(0)
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(290)
    vi.restoreAllMocks()
  })

  it('should report a refusal that outlasts the retries as a rate limit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    network.use(
      http.get(SEARCH_URL, () =>
        HttpResponse.json(
          { message: 'You are being rate limited.', retry_after: 0.01 },
          { status: 429, headers: { 'Retry-After': '0.01' } },
        ),
      ),
    )

    await expect(
      newAdapter().searchMessages({ query: 'a' }),
    ).rejects.toBeInstanceOf(RateLimitedError)
    vi.restoreAllMocks()
  })
})
