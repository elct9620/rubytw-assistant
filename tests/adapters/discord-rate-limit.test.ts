import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi } from 'vitest'
import { container } from '../../src/container'
import { DiscordSourceAdapter } from '../../src/adapters/discord-source'
import { DiscordRateLimiter } from '../../src/adapters/discord-rate-limit'
import { TOKENS } from '../../src/tokens'
import type { DiscordSource } from '../../src/usecases/ports'
import { RateLimitedError } from '../../src/usecases/ports'
import { network } from '../msw-server'

const SEARCH_URL = 'https://discord.com/api/v10/guilds/guild-1/messages/search'

const newAdapter = () =>
  new DiscordSourceAdapter('bot-token', 'channel-123', 'assistant-1', 'guild-1')

const emptyHits = (headers: Record<string, string> = {}) =>
  HttpResponse.json({ total_results: 0, messages: [] }, { headers })

function spentLimitServer() {
  let inFlight = 0
  const seen = { maxInFlight: 0 }
  network.use(
    http.get(SEARCH_URL, async () => {
      seen.maxInFlight = Math.max(seen.maxInFlight, ++inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight--
      return emptyHits({
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset-After': '0.05',
      })
    }),
  )
  return seen
}

describe('Discord rate limit pacing', () => {
  it('should pace every Discord adapter resolved for one invocation together', async () => {
    const seen = spentLimitServer()
    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'bot-token' })
    child.register(TOKENS.DiscordChannelId, { useValue: 'channel-123' })
    child.register(TOKENS.DiscordClientId, { useValue: 'assistant-1' })
    child.register(TOKENS.DiscordGuildId, { useValue: 'guild-1' })
    const first = child.resolve<DiscordSource>(TOKENS.DiscordSource)
    const second = child.resolve<DiscordSource>(TOKENS.DiscordSource)

    await Promise.all([
      first.searchMessages({ query: 'a' }),
      second.searchMessages({ query: 'b' }),
    ])

    expect(seen.maxInFlight).toBe(1)
  })

  it('should not hold a request behind one that failed', async () => {
    const limiter = new DiscordRateLimiter()
    let calls = 0
    network.use(
      http.get(SEARCH_URL, () =>
        ++calls === 1 ? HttpResponse.error() : emptyHits(),
      ),
    )

    const failed = limiter.fetch('route', SEARCH_URL)
    const next = limiter.fetch('route', SEARCH_URL)

    await expect(failed).rejects.toThrow()
    expect((await next).status).toBe(200)
  })

  it('should refuse at once rather than wait out an unreasonably long limit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    network.use(
      http.get(SEARCH_URL, () =>
        HttpResponse.json(
          { message: 'You are being rate limited.', retry_after: 600 },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    )
    const started = Date.now()

    await expect(
      newAdapter().searchMessages({ query: 'a' }),
    ).rejects.toBeInstanceOf(RateLimitedError)
    expect(Date.now() - started).toBeLessThan(5_000)
    vi.restoreAllMocks()
  })

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
