import type { Octokit } from '@octokit/core'
import type { GitHubSource, IssueFilter } from '../usecases/ports'
import { escapeXml } from './shared'
import { withRetry } from '../services/retry'

interface ProjectItemNode {
  content: {
    __typename: string
    title: string
    number: number
    state: string
    url: string
    labels: { nodes: { name: string }[] }
    assignees: { nodes: { login: string }[] }
  } | null
  fieldValues: {
    nodes: FieldValueNode[]
  }
}

interface FieldValueNode {
  __typename?: string
  name?: string
  field?: { name: string }
}

interface ProjectQueryResult {
  organization: {
    projectV2: {
      items: {
        nodes: ProjectItemNode[]
      }
    }
  }
}

export interface FormattedIssue {
  title: string
  number: number
  state: string
  url: string
  labels: string[]
  assignees: string[]
  status: string | null
}

const PROJECT_ITEMS_QUERY = `
  query ($organization: String!, $number: Int!) {
    organization(login: $organization) {
      projectV2(number: $number) {
        items(first: 50) {
          nodes {
            content {
              __typename
              ... on Issue {
                title
                number
                state
                url
                labels(first: 5) { nodes { name } }
                assignees(first: 5) { nodes { login } }
              }
            }
            fieldValues(first: 8) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`

function extractStatus(fieldValues: FieldValueNode[]): string | null {
  const statusField = fieldValues.find(
    (fv) =>
      fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
      fv.field?.name === 'Status',
  )
  return statusField?.name ?? null
}

export function formatIssueToXml(issue: FormattedIssue): string {
  const parts = [
    `<issue number="${issue.number}" state="${escapeXml(issue.state)}" url="${escapeXml(issue.url)}">`,
    `  <title>${escapeXml(issue.title)}</title>`,
  ]

  if (issue.labels.length > 0) {
    const labels = issue.labels.map(escapeXml).join(', ')
    parts.push(`  <labels>${labels}</labels>`)
  }

  if (issue.assignees.length > 0) {
    const assignees = issue.assignees.map(escapeXml).join(', ')
    parts.push(`  <assignees>${assignees}</assignees>`)
  }

  if (issue.status) {
    parts.push(`  <status>${escapeXml(issue.status)}</status>`)
  }

  parts.push('</issue>')
  return parts.join('\n')
}

// Registered in the DI container via `useFactory` so Octokit can be
// wrapped with the GitHub App auth strategy. Intentionally not marked
// `@injectable()` — tsyringe never resolves this adapter's constructor
// directly.
export class GitHubSourceAdapter implements GitHubSource {
  constructor(
    private octokit: Octokit,
    private org: string,
    private projectNumber: number,
  ) {}

  async getIssues(filter?: IssueFilter): Promise<string[]> {
    const result = await withRetry(
      () =>
        this.octokit.graphql<ProjectQueryResult>(PROJECT_ITEMS_QUERY, {
          organization: this.org,
          number: this.projectNumber,
        }),
      {
        onRetry: (error, attempt) => {
          console.warn(
            `GitHub getIssues retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )

    const items = result.organization.projectV2.items.nodes

    return items
      .filter((item) => item.content && item.content.__typename === 'Issue')
      .map((item) => {
        const content = item.content!
        return {
          title: content.title,
          number: content.number,
          state: content.state,
          url: content.url,
          labels: content.labels.nodes.map((l) => l.name),
          assignees: content.assignees.nodes.map((a) => a.login),
          status: extractStatus(item.fieldValues.nodes),
        }
      })
      .filter((issue) => {
        if (filter?.state && issue.state !== filter.state) return false
        return true
      })
      .map(formatIssueToXml)
  }
}
