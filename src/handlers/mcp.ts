import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'
import { registerMemoryTools } from './mcp-tools'

export const MCP_ROUTE = '/mcp'

function createServer(): McpServer {
  const server = new McpServer({
    name: 'rubytw-assistant',
    version: '1.0.0',
  })
  registerMemoryTools(server)
  return server
}

const handler = createMcpHandler(createServer, { route: MCP_ROUTE })

/** OAuthProvider accepts an ExportedHandler, not the callable createMcpHandler returns. */
export const mcpApiHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    handler(request, env, ctx),
}
