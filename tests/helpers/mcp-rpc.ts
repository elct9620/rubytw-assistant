import { env } from 'cloudflare:workers'
import { createExecutionContext } from 'cloudflare:test'
import { mcpApiHandler } from '../../src/handlers/mcp'

export interface McpIdentity {
  userId: string
  username: string
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

let nextId = 1

/**
 * Drives the MCP endpoint the way OAuthProvider does — identity travels on
 * `ctx.props` — so a test reaches the tools without minting a real grant.
 */
export async function mcpRequest(
  method: string,
  params: unknown = {},
  identity?: McpIdentity,
): Promise<JsonRpcResponse> {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      host: 'localhost',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })

  const ctx = Object.assign(createExecutionContext(), {
    props: identity ?? {},
  })

  const response = await mcpApiHandler.fetch(request, env, ctx)
  return parseEventStream(await response.text())
}

function parseEventStream(body: string): JsonRpcResponse {
  const payloads = body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))

  if (payloads.length === 0) {
    throw new Error(`No JSON-RPC payload in MCP response: ${body}`)
  }

  return JSON.parse(payloads[payloads.length - 1]) as JsonRpcResponse
}
