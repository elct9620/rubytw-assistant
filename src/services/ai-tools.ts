import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { MemoryStore, GitHubSource } from '../usecases/ports'

export interface AIToolsDeps {
  memoryStore: MemoryStore
  githubSource: GitHubSource
  memoryEntryLimit: number
  memoryDescriptionLimit: number
}

export function createAITools(deps: AIToolsDeps): ToolSet {
  return { ...createMemoryTools(deps), ...createGitHubTools(deps) }
}

function createMemoryTools({
  memoryStore,
  memoryEntryLimit,
  memoryDescriptionLimit,
}: AIToolsDeps): ToolSet {
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
          const entries = await memoryStore.read(indices)
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
        try {
          await memoryStore.update(index, description, content)
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

function createGitHubTools({ githubSource }: AIToolsDeps): ToolSet {
  return {
    github_get_issues: tool({
      description:
        'Query GitHub Projects V2 issues to check task status and relate conversations to existing issues. Returns all issues by default; use filters to narrow results.',
      inputSchema: z.object({
        state: z
          .enum(['OPEN', 'CLOSED'])
          .optional()
          .describe('Filter issues by state. Returns all if omitted.'),
      }),
      execute: async ({ state }) => {
        try {
          const filter = {
            ...(state && { state }),
          }
          const issues = await githubSource.getIssues(filter)
          return { issues, count: issues.length }
        } catch (error) {
          console.warn('GitHub get issues failed', error)
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
  }
}
