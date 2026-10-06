import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
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

const handler = createMcpHandler(createServer)

/**
 * OAuthProvider accepts an ExportedHandler, and routes every path that merely
 * starts with MCP_ROUTE here, so anything else is turned away.
 */
export const mcpApiHandler = {
  fetch: (request: Request) =>
    new URL(request.url).pathname === MCP_ROUTE
      ? handler.fetch(request)
      : Promise.resolve(new Response('Not Found', { status: 404 })),
}
