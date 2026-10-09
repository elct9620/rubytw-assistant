import { env } from 'cloudflare:workers'
import {
  createExecutionContext,
  createScheduledController,
} from 'cloudflare:test'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import worker from '../../src/index'
import { mcpApiHandler } from '../../src/handlers/mcp'
import { mcpRequest } from '../helpers/mcp-rpc'

describe('OAuth-protected MCP endpoint', () => {
  it('should advertise the authorization endpoints in server metadata', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/.well-known/oauth-authorization-server'),
      env,
      createExecutionContext(),
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
      createExecutionContext(),
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
      createExecutionContext(),
    )

    expect(res.status).toBe(401)
  })

  it('should serve a client whose identity the authorization layer already settled', async () => {
    const response = await mcpRequest(
      'ping',
      {},
      {
        userId: '42',
        username: 'operator',
      },
    )

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({})
  })

  it('should not serve MCP on paths that only share its prefix', async () => {
    const res = await mcpApiHandler.fetch(
      new Request('http://localhost/mcp-other', { method: 'POST' }),
    )

    expect(res.status).toBe(404)
  })

  it('should offer the memory tools to a served client', async () => {
    const response = await mcpRequest(
      'tools/list',
      {},
      {
        userId: '42',
        username: 'operator',
      },
    )

    const tools = (response.result?.tools as { name: string }[]) ?? []
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'list_memories',
      'read_memories',
      'read_memory_summary',
      'update_memories',
      'write_memory_summary',
    ])
  })

  it('should leave unclaimed paths with the existing Hono app', async () => {
    const res = await worker.fetch!(
      new Request('http://localhost/'),
      env,
      createExecutionContext(),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })
})

describe('cron entry point after the OAuth provider wraps fetch', () => {
  const mockExecute = vi.fn()
  const mockPresent = vi.fn()

  beforeEach(() => {
    container.register(TOKENS.SummaryHours, { useValue: 12 })
    container.register(TOKENS.SummaryPresenter, {
      useValue: { present: mockPresent },
    })
    container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
    container.register(GenerateSummary, {
      useFactory: () => ({ execute: mockExecute }),
    })
    mockExecute.mockReset().mockResolvedValue({ kind: 'success', items: [] })
    mockPresent.mockReset().mockResolvedValue(undefined)
  })

  it('should still run the daily summary when the cron fires', async () => {
    await worker.scheduled!(
      createScheduledController({ cron: '0 16 * * *' }),
      env,
      createExecutionContext(),
    )

    expect(mockExecute).toHaveBeenCalledWith(12)
    expect(mockPresent).toHaveBeenCalledOnce()
  })
})
