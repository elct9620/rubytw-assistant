import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { MemoryStore, GitHubSource } from '../usecases/ports'

export interface AIToolsDeps {
  memoryStore: MemoryStore
  githubSource: GitHubSource
  memoryEntryLimit: number
}

export function createAITools(deps: AIToolsDeps): ToolSet {
  return { ...createMemoryTools(deps), ...createGitHubTools(deps) }
}

function createMemoryTools({
  memoryStore,
  memoryEntryLimit,
}: AIToolsDeps): ToolSet {
  return {
    memory_read: tool({
      description:
        'Read all memory entries from persistent store to recall context from previous executions',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const entries = await memoryStore.list()
          return { entries, count: entries.length, limit: memoryEntryLimit }
        } catch {
          console.warn('Memory read failed')
          return {
            entries: [],
            count: 0,
            limit: memoryEntryLimit,
            error: 'read failed',
          }
        }
      },
    }),
    memory_write: tool({
      description:
        'Write a memory entry to persistent store for future executions',
      inputSchema: z.object({
        key: z.string().describe('unique identifier for this memory entry'),
        content: z.string().describe('the information to remember'),
        tag: z.string().optional().describe('category tag for organization'),
      }),
      execute: async ({ key, content, tag }) => {
        try {
          await memoryStore.put({
            key,
            content,
            tag,
            updatedAt: new Date().toISOString(),
          })
          return { success: true }
        } catch (e) {
          console.warn('Memory write failed:', e)
          return {
            success: false,
            error: 'write failed - entry limit may be reached',
          }
        }
      },
    }),
    memory_delete: tool({
      description: 'Delete a memory entry from persistent store to free space',
      inputSchema: z.object({
        key: z.string().describe('key of the entry to delete'),
      }),
      execute: async ({ key }) => {
        try {
          await memoryStore.delete(key)
          return { success: true }
        } catch {
          console.warn('Memory delete failed')
          return { success: false, error: 'delete failed' }
        }
      },
    }),
  }
}

function createGitHubTools({ githubSource }: AIToolsDeps): ToolSet {
  return {
    github_get_issues: tool({
      description:
        'Query GitHub Projects V2 issues to check task status and relate conversations to existing issues',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const issues = await githubSource.getIssues()
          return { issues, count: issues.length }
        } catch {
          console.warn('GitHub get issues failed')
          return { issues: [], count: 0, error: 'query failed' }
        }
      },
    }),
    github_get_project_activities: tool({
      description:
        'Query GitHub Projects V2 recent activities to understand project progress',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const activities = await githubSource.getProjectActivities()
          return { activities, count: activities.length }
        } catch {
          console.warn('GitHub get project activities failed')
          return { activities: [], count: 0, error: 'query failed' }
        }
      },
    }),
  }
}
