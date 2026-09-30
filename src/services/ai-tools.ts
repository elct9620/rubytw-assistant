import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type {
  DiscordSource,
  GitHubSource,
  MemoryStore,
} from '../usecases/ports'

export interface AIToolsDeps {
  memoryStore: MemoryStore
  githubSource: GitHubSource
  discordSource: DiscordSource
  memoryEntryLimit: number
  memoryDescriptionLimit: number
  issueBodyLengthLimit: number
  summaryHours: number
}

const READ_MESSAGES_DEFAULT_LIMIT = 50
const READ_MESSAGES_MAX_LIMIT = 100

export function createAITools(deps: AIToolsDeps): ToolSet {
  return {
    ...createMemoryTools(deps),
    ...createGitHubTools(deps),
    ...createDiscordTools(deps),
  }
}

function createMemoryTools({
  memoryStore,
  memoryEntryLimit,
  memoryDescriptionLimit,
}: AIToolsDeps): ToolSet {
  const readIndices = new Set<number>()

  return {
    list_memories: tool({
      description:
        'List all memory slots with their index and description. Use this to see what is stored before reading or updating.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const slots = await memoryStore.list()
          return { slots, limit: memoryEntryLimit }
        } catch {
          console.warn('Memory list failed')
          return { slots: [], limit: memoryEntryLimit, error: 'list failed' }
        }
      },
    }),
    read_memories: tool({
      description:
        'Read full content of memory slots by their indices. Use after list_memories to get details for specific slots.',
      inputSchema: z.object({
        indices: z
          .array(
            z
              .number()
              .int()
              .min(0)
              .max(memoryEntryLimit - 1),
          )
          .describe('slot indices to read'),
      }),
      execute: async ({ indices }) => {
        try {
          const uniqueIndices = Array.from(new Set(indices))
          const entries = await memoryStore.read(uniqueIndices)
          for (const entry of entries) readIndices.add(entry.index)
          return { entries }
        } catch {
          console.warn('Memory read failed')
          return { entries: [], error: 'read failed' }
        }
      },
    }),
    update_memory: tool({
      description: `Write description and content to a memory slot. Write empty content to clear the slot. Description max ${memoryDescriptionLimit} characters.`,
      inputSchema: z.object({
        index: z
          .number()
          .int()
          .min(0)
          .max(memoryEntryLimit - 1)
          .describe('slot index to write'),
        description: z
          .string()
          .max(memoryDescriptionLimit)
          .describe('short description of what this slot stores'),
        content: z
          .string()
          .describe('the information to store, or empty string to clear'),
      }),
      execute: async ({ index, description, content }) => {
        if (!readIndices.has(index)) {
          return {
            success: false,
            error: `must read_memories for index ${index} before updating`,
          }
        }
        try {
          await memoryStore.update({ [index]: { description, content } })
          return { success: true }
        } catch (e) {
          console.warn('Memory update failed:', e)
          return {
            success: false,
            error: e instanceof Error ? e.message : 'update failed',
          }
        }
      },
    }),
  }
}

function createGitHubTools({
  githubSource,
  issueBodyLengthLimit,
}: AIToolsDeps): ToolSet {
  return {
    list_issues: tool({
      description:
        'Discovery entry point: list GitHub Projects V2 issues with their overview (number, title, state, labels, assignees, status). Returns up to 50 issues. Use this first to find relevant issue numbers before fetching details.',
      inputSchema: z.object({
        state: z
          .enum(['OPEN', 'CLOSED'])
          .optional()
          .describe('Filter issues by state. Returns all if omitted.'),
      }),
      execute: async ({ state }) => {
        try {
          const issues = await githubSource.listIssues(state)
          return { issues, count: issues.length }
        } catch (error) {
          console.warn('GitHub list issues failed', error)
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
    read_issues: tool({
      description:
        'Detail fetch: retrieve full issue details (body, comments) for up to 10 specific issue numbers. Use after list_issues to get complete information for issues of interest.',
      inputSchema: z.object({
        numbers: z
          .array(z.number().int().positive())
          .min(1)
          .max(10)
          .describe('Issue numbers to fetch (1–10 items)'),
      }),
      execute: async ({ numbers }) => {
        try {
          const issues = await githubSource.readIssues(
            numbers,
            issueBodyLengthLimit,
          )
          return { issues, count: issues.length }
        } catch (error) {
          console.warn('GitHub read issues failed', error)
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
  }
}

const isoTime = z.iso.datetime({ offset: true })
const numericId = z.string().regex(/^\d+$/)

const noMessages = (error: string) => ({
  messages: [],
  count: 0,
  next_cursor: null,
  error,
})

function createDiscordTools({
  discordSource,
  summaryHours,
}: AIToolsDeps): ToolSet {
  return {
    read_messages: tool({
      description: `Read the channel's messages in a time range, oldest first, one bounded page per call. Defaults to the last ${summaryHours} hours. When next_cursor is not null, call again with the same range plus that cursor to continue.`,
      inputSchema: z.object({
        since: isoTime
          .optional()
          .describe(
            `ISO 8601 start of the range, inclusive. Defaults to ${summaryHours} hours ago.`,
          ),
        until: isoTime
          .optional()
          .describe('ISO 8601 end of the range, exclusive. Defaults to now.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(READ_MESSAGES_MAX_LIMIT)
          .optional()
          .describe(
            `Messages per call (1–${READ_MESSAGES_MAX_LIMIT}). Defaults to ${READ_MESSAGES_DEFAULT_LIMIT}.`,
          ),
        cursor: numericId
          .optional()
          .describe('next_cursor from the previous call of the same range'),
      }),
      execute: async ({ since, until, limit, cursor }) => {
        const start = since
          ? new Date(since)
          : new Date(Date.now() - summaryHours * 3600 * 1000)
        const end = until ? new Date(until) : undefined
        if (end && start > end) {
          return noMessages('since must not be later than until')
        }

        try {
          const page = await discordSource.readMessages({
            since: start,
            until: end,
            limit: limit ?? READ_MESSAGES_DEFAULT_LIMIT,
            cursor,
          })
          return {
            messages: page.messages,
            count: page.messages.length,
            next_cursor: page.nextCursor,
          }
        } catch (error) {
          console.warn('Discord read messages failed', error)
          return noMessages('query failed')
        }
      },
    }),
    search_messages: tool({
      description:
        "Search the channel's messages, newest first, up to 25 per call. Every condition given must match; give none to get the most recent messages. When next_cursor is not null, call again with the same conditions plus that cursor for older matches.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .optional()
          .describe('keywords the message text must contain'),
        author: z
          .union([z.literal('self'), numericId])
          .optional()
          .describe(
            'who sent the message: "self" for your own messages, or a member id',
          ),
        involves_self: z
          .enum(['mention', 'reply'])
          .optional()
          .describe(
            '"mention" for messages that mention you, "reply" for messages replying to one of yours',
          ),
        since: isoTime
          .optional()
          .describe('ISO 8601 start of the range, inclusive'),
        until: isoTime
          .optional()
          .describe('ISO 8601 end of the range, exclusive'),
        cursor: numericId
          .optional()
          .describe('next_cursor from the previous call of the same search'),
      }),
      execute: async ({
        query,
        author,
        involves_self,
        since,
        until,
        cursor,
      }) => {
        try {
          const page = await discordSource.searchMessages({
            query,
            author,
            involvesSelf: involves_self,
            since: since ? new Date(since) : undefined,
            until: until ? new Date(until) : undefined,
            cursor,
          })
          return {
            messages: page.messages,
            count: page.messages.length,
            total: page.total,
            next_cursor: page.nextCursor,
          }
        } catch (error) {
          console.warn('Discord search messages failed', error)
          return { ...noMessages('query failed'), total: 0 }
        }
      },
    }),
  }
}
