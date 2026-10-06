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

// The model fills in every parameter of a call, so optional ones are nullish:
// null is how it says it has nothing to give.
export function createAITools(deps: AIToolsDeps): ToolSet {
  return {
    ...createMemoryTools(deps),
    ...createGitHubTools(deps),
    ...createDiscordTools(deps),
  }
}

export function createMemoryTools({
  memoryStore,
  memoryEntryLimit,
  memoryDescriptionLimit,
}: Pick<
  AIToolsDeps,
  'memoryStore' | 'memoryEntryLimit' | 'memoryDescriptionLimit'
>): ToolSet {
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
          .nullish()
          .describe('Filter issues by state. Null returns all.'),
      }),
      execute: async ({ state }) => {
        try {
          const issues = await githubSource.listIssues(state ?? undefined)
          return { issues, count: issues.length }
        } catch (error) {
          console.warn('GitHub list issues failed', error)
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
    search_issues: tool({
      description:
        'Find issues in the repository by keyword, including ones that are not on the project board. Returns up to 20 issues with the same overview as list_issues; status is null for an issue that is not on the board. Every word in the query must match, so use one or two distinctive keywords rather than a phrase. An empty result means this query matched nothing, not that no issue exists: retry with a single broader keyword before concluding. GitHub issue search qualifiers such as label:, assignee: or state:open may be used in the query.',
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .describe(
            'one or two distinctive keywords, optionally with GitHub issue search qualifiers',
          ),
      }),
      execute: async ({ query }) => {
        try {
          const issues = await githubSource.searchIssues(query)
          return { issues, count: issues.length }
        } catch (error) {
          console.warn('GitHub search issues failed', error)
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
    read_issues: tool({
      description:
        'Detail fetch: retrieve full issue details (body, last-updated time, the 5 most recent comments) for up to 10 specific issue numbers. Use after list_issues or search_issues to confirm the current state of issues of interest. Body and comments are truncated.',
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
          .nullish()
          .describe(
            `ISO 8601 start of the range, inclusive. Defaults to ${summaryHours} hours ago.`,
          ),
        until: isoTime
          .nullish()
          .describe('ISO 8601 end of the range, exclusive. Defaults to now.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(READ_MESSAGES_MAX_LIMIT)
          .nullish()
          .describe(
            `Messages per call (1–${READ_MESSAGES_MAX_LIMIT}). Defaults to ${READ_MESSAGES_DEFAULT_LIMIT}.`,
          ),
        cursor: numericId
          .nullish()
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
            cursor: cursor ?? undefined,
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
        "Search the channel's messages, newest first, up to 25 per call. Every condition given must match, so each extra one removes results: pass only the conditions you need and set every other parameter to null. Give none to get the most recent messages. When next_cursor is not null, call again with the same conditions plus that cursor for older matches. A reply in the results names only the id of the message it answers, not its author; use involves_self or read_messages when you need to know who was answered.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .nullish()
          .describe(
            'a single keyword the message text must contain; every word given must match, so two words together usually match nothing',
          ),
        author: z
          .union([z.literal('self'), z.literal('people'), numericId])
          .nullish()
          .describe(
            'who sent the message: "people" for members only (leaves out your own summaries and other bots), "self" for your own messages, or a member id',
          ),
        involves_self: z
          .enum(['mention', 'reply'])
          .nullish()
          .describe(
            '"mention" for messages that mention you, "reply" for messages replying to one of yours',
          ),
        since: isoTime
          .nullish()
          .describe('ISO 8601 start of the range, inclusive'),
        until: isoTime
          .nullish()
          .describe('ISO 8601 end of the range, exclusive'),
        cursor: numericId
          .nullish()
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
            query: query ?? undefined,
            author: author ?? undefined,
            involvesSelf: involves_self ?? undefined,
            since: since ? new Date(since) : undefined,
            until: until ? new Date(until) : undefined,
            cursor: cursor ?? undefined,
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
