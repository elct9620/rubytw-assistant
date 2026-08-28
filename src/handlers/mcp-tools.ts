import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { container } from '../container'
import { TOKENS } from '../tokens'
import type {
  MemoryStore,
  MemorySummaryStore,
  MemoryUpdate,
} from '../usecases/ports'

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

/**
 * Resolves its collaborators per call because the memory store caches slots
 * for the lifetime of one request; a server outliving that would serve stale
 * slots from a warm isolate.
 */
export function registerMemoryTools(server: McpServer): void {
  const memory = container.resolve<MemoryStore>(TOKENS.MemoryStore)
  const summary = container.resolve<MemorySummaryStore>(
    TOKENS.MemorySummaryStore,
  )
  const entryLimit = container.resolve<number>(TOKENS.MemoryEntryLimit)
  const descriptionLimit = container.resolve<number>(
    TOKENS.MemoryDescriptionLimit,
  )
  const summaryLimit = container.resolve<number>(
    TOKENS.MemorySummaryLengthLimit,
  )

  server.registerTool(
    'list_memories',
    {
      title: 'List memory slots',
      description: `List every memory slot with its index and description. ${entryLimit} slots exist; an unused slot has an empty description.`,
      inputSchema: z.object({}),
    },
    async () => json({ slots: await memory.list(), limit: entryLimit }),
  )

  server.registerTool(
    'read_memories',
    {
      title: 'Read memory slots',
      description:
        'Read the full content of memory slots by index. Use list_memories first to see what each slot holds.',
      inputSchema: z.object({
        indices: z
          .array(
            z
              .number()
              .int()
              .min(0)
              .max(entryLimit - 1),
          )
          .min(1)
          .describe('slot indices to read'),
      }),
    },
    async ({ indices }) =>
      json({ entries: await memory.read(Array.from(new Set(indices))) }),
  )

  server.registerTool(
    'update_memories',
    {
      title: 'Update memory slots',
      description: `Write memory slots, keyed by slot index. Several slots may be written at once. Write empty content to clear a slot. Description max ${descriptionLimit} characters.`,
      inputSchema: z.object({
        entries: z
          .record(
            z
              .string()
              .regex(/^(0|[1-9]\d*)$/)
              .describe(`slot index, 0 to ${entryLimit - 1}`),
            z.object({
              description: z
                .string()
                .max(descriptionLimit)
                .describe('short description of what this slot stores'),
              content: z
                .string()
                .describe('the information to store, or empty to clear'),
            }),
          )
          .describe('slot index to the values written there'),
      }),
    },
    async ({ entries }) => {
      const update: MemoryUpdate = {}
      for (const [index, slot] of Object.entries(entries)) {
        update[Number(index)] = slot
      }

      await memory.update(update)
      return json({
        updated: Object.keys(update)
          .map(Number)
          .sort((a, b) => a - b),
      })
    },
  )

  server.registerTool(
    'read_memory_summary',
    {
      title: 'Read the memory summary',
      description:
        'Read the condensed summary injected into the next pipeline run.',
      inputSchema: z.object({}),
    },
    async () => json({ summary: await summary.read() }),
  )

  server.registerTool(
    'write_memory_summary',
    {
      title: 'Replace the memory summary',
      description: `Replace the condensed summary injected into the next pipeline run. Max ${summaryLimit} characters.`,
      inputSchema: z.object({
        summary: z
          .string()
          .max(summaryLimit)
          .describe('the summary to inject into the next run'),
      }),
    },
    async ({ summary: text }) => {
      await summary.write(text)
      return json({ written: text.length })
    },
  )
}
