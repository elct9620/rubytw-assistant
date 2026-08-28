import { env } from 'cloudflare:workers'
import { createScheduledController } from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import worker from '../../src/index'

describe('OAuth-protected MCP endpoint', () => {
  it('should advertise the authorization endpoints in server metadata', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/.well-known/oauth-authorization-server'),
      env,
      {} as ExecutionContext,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, string>
    expect(body.authorization_endpoint).toBe('http://localhost/authorize')
    expect(body.token_endpoint).toBe('http://localhost/oauth/token')
  })

  it('should reject an MCP request that carries no access token', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/mcp', { method: 'POST' }),
      env,
      {} as ExecutionContext,
    )

    expect(res.status).toBe(401)
  })

  it('should reject an MCP request whose access token is unknown', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer not-a-real-token' },
      }),
      env,
      {} as ExecutionContext,
    )

    expect(res.status).toBe(401)
  })

  it('should leave unclaimed paths with the existing Hono app', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/'),
      env,
      {} as ExecutionContext,
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })
})

describe('cron entry point after the OAuth provider wraps fetch', () => {
  const mockExecute = vi.fn()
  const mockPresent = vi.fn()

  beforeEach(() => {
    container.clearInstances()
    container.register(TOKENS.SummaryHours, { useValue: 12 })
    container.register(TOKENS.SummaryPresenter, {
      useValue: { present: mockPresent },
    })
    container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
    container.register(GenerateSummary, {
      useFactory: () => ({ execute: mockExecute }),
    })
    mockExecute.mockReset().mockResolvedValue({ kind: 'empty' })
    mockPresent.mockReset().mockResolvedValue(undefined)
  })

  it('should still run the daily summary when the cron fires', async () => {
    await worker.scheduled!(
      createScheduledController({ cron: '0 16 * * *' }),
      env,
      {} as ExecutionContext,
    )

    expect(mockExecute).toHaveBeenCalledWith(12)
    expect(mockPresent).toHaveBeenCalledOnce()
  })
})
