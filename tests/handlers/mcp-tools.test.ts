import { env } from 'cloudflare:workers'
import { describe, it, expect, beforeEach } from 'vitest'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import { Client } from '@modelcontextprotocol/client'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { registerMemoryTools } from '../../src/handlers/mcp-tools'
import { KV_KEY as SLOTS_KEY } from '../../src/adapters/kv-memory-store'
import { KV_KEY as SUMMARY_KEY } from '../../src/adapters/kv-memory-summary-store'

const ENTRY_LIMIT = 32
const SUMMARY_LIMIT = 300

async function connect(): Promise<Client> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' })
  registerMemoryTools(server)

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

const payload = <T>(result: CallToolResult): T =>
  JSON.parse((result.content[0] as { text: string }).text) as T

const seedSlots = (slots: { description: string; content: string }[]) =>
  env.MEMORY_KV.put(
    SLOTS_KEY,
    JSON.stringify([
      ...slots,
      ...Array.from({ length: ENTRY_LIMIT - slots.length }, () => ({
        description: '',
        content: '',
      })),
    ]),
  )

describe('MCP memory tools', () => {
  beforeEach(async () => {
    await env.MEMORY_KV.delete(SLOTS_KEY)
    await env.MEMORY_KV.delete(SUMMARY_KEY)
  })

  it('should advertise every memory tool', async () => {
    const client = await connect()

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual([
      'list_memories',
      'read_memories',
      'read_memory_summary',
      'update_memories',
      'write_memory_summary',
    ])
  })

  it('should list every slot with its description', async () => {
    await seedSlots([{ description: 'ongoing tasks', content: 'details' }])
    const client = await connect()

    const result = await client.callTool({
      name: 'list_memories',
      arguments: {},
    })

    const { slots, limit } = payload<{
      slots: { index: number; description: string }[]
      limit: number
    }>(result)
    expect(limit).toBe(ENTRY_LIMIT)
    expect(slots).toHaveLength(ENTRY_LIMIT)
    expect(slots[0]).toEqual({ index: 0, description: 'ongoing tasks' })
    expect(slots[1]).toEqual({ index: 1, description: '' })
  })

  it('should read the content of the slots asked for', async () => {
    await seedSlots([
      { description: 'first', content: 'first content' },
      { description: 'second', content: 'second content' },
    ])
    const client = await connect()

    const result = await client.callTool({
      name: 'read_memories',
      arguments: { indices: [1] },
    })

    expect(payload(result)).toEqual({
      entries: [{ index: 1, description: 'second', content: 'second content' }],
    })
  })

  it('should write several slots in one call', async () => {
    const client = await connect()

    const result = await client.callTool({
      name: 'update_memories',
      arguments: {
        entries: {
          0: { description: 'first', content: 'first content' },
          3: { description: 'fourth', content: 'fourth content' },
        },
      },
    })

    expect(payload(result)).toEqual({ updated: [0, 3] })
    const stored = await env.MEMORY_KV.get<
      { description: string; content: string }[]
    >(SLOTS_KEY, 'json')
    expect(stored![0]).toEqual({
      description: 'first',
      content: 'first content',
    })
    expect(stored![3]).toEqual({
      description: 'fourth',
      content: 'fourth content',
    })
  })

  it('should clear a slot given empty content', async () => {
    await seedSlots([{ description: 'to be cleared', content: 'content' }])
    const client = await connect()

    await client.callTool({
      name: 'update_memories',
      arguments: { entries: { 0: { description: 'ignored', content: '' } } },
    })

    const stored = await env.MEMORY_KV.get<
      { description: string; content: string }[]
    >(SLOTS_KEY, 'json')
    expect(stored![0]).toEqual({ description: '', content: '' })
  })

  it('should refuse an index beyond the slot count', async () => {
    const client = await connect()

    const result = await client.callTool({
      name: 'update_memories',
      arguments: {
        entries: { [ENTRY_LIMIT]: { description: 'a', content: 'b' } },
      },
    })

    expect(result.isError).toBe(true)
  })

  it('should leave every slot untouched when one entry is refused', async () => {
    await seedSlots([{ description: 'kept', content: 'kept content' }])
    const client = await connect()

    await client.callTool({
      name: 'update_memories',
      arguments: {
        entries: {
          0: { description: 'overwritten', content: 'overwritten' },
          [ENTRY_LIMIT]: { description: 'a', content: 'b' },
        },
      },
    })

    const stored = await env.MEMORY_KV.get<
      { description: string; content: string }[]
    >(SLOTS_KEY, 'json')
    expect(stored![0]).toEqual({
      description: 'kept',
      content: 'kept content',
    })
  })

  it('should report no summary when none was written', async () => {
    const client = await connect()

    const result = await client.callTool({
      name: 'read_memory_summary',
      arguments: {},
    })

    expect(payload(result)).toEqual({ summary: null })
  })

  it('should replace the summary', async () => {
    const client = await connect()

    await client.callTool({
      name: 'write_memory_summary',
      arguments: { summary: 'the community is planning a meetup' },
    })

    const result = await client.callTool({
      name: 'read_memory_summary',
      arguments: {},
    })
    expect(payload(result)).toEqual({
      summary: 'the community is planning a meetup',
    })
  })

  it('should refuse a summary longer than the configured limit', async () => {
    const client = await connect()

    const result = await client.callTool({
      name: 'write_memory_summary',
      arguments: { summary: 'a'.repeat(SUMMARY_LIMIT + 1) },
    })

    expect(result.isError).toBe(true)
    expect(await env.MEMORY_KV.get(SUMMARY_KEY, 'text')).toBeNull()
  })
})
