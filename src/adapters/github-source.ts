import type { Octokit } from '@octokit/core'
import type {
  GitHubSource,
  IssueDetail,
  IssueOverview,
} from '../usecases/ports'
import { withRetry } from '../services/retry'

interface IssueNode {
  __typename: string
  title: string
  number: number
  state: string
  url: string
  labels: { nodes: { name: string }[] }
  assignees: { nodes: { login: string }[] }
  body: string
}

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

const READ_ISSUES_MAX = 10

function buildReadIssuesQuery(numbers: number[]): string {
  const issueFragment = `
    __typename
    title
    number
    state
    url
    labels(first: 5) { nodes { name } }
    assignees(first: 5) { nodes { login } }
    body
    projectItems(first: 1) {
      nodes {
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
  `
  const aliases = numbers
    .map((n, i) => `issue${i}: issue(number: ${n}) { ${issueFragment} }`)
    .join('\n')
  return `
    query ($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        ${aliases}
      }
    }
  `
}

interface ReadIssueNode extends IssueNode {
  projectItems: {
    nodes: {
      fieldValues: { nodes: FieldValueNode[] }
    }[]
  }
}

interface ReadIssuesQueryResult {
  repository: Record<string, ReadIssueNode | null>
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

// Registered in the DI container via `useFactory` so Octokit can be
// wrapped with the GitHub App auth strategy. Intentionally not marked
// `@injectable()` — tsyringe never resolves this adapter's constructor
// directly.
export class GitHubSourceAdapter implements GitHubSource {
  constructor(
    private octokit: Octokit,
    private org: string,
    private projectNumber: number,
    private repo: string = '',
  ) {}

  async listIssues(state?: 'OPEN' | 'CLOSED'): Promise<IssueOverview[]> {
    const result = await withRetry(
      () =>
        this.octokit.graphql<ProjectQueryResult>(PROJECT_ITEMS_QUERY, {
          organization: this.org,
          number: this.projectNumber,
        }),
      {
        onRetry: (error, attempt) => {
          console.warn(
            `GitHub listIssues retry ${attempt}:`,
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
        if (state && issue.state !== state) return false
        return true
      })
  }

  async readIssues(
    numbers: number[],
    bodyLimit: number,
  ): Promise<IssueDetail[]> {
    if (numbers.length > READ_ISSUES_MAX) {
      throw new Error(
        `readIssues accepts at most ${READ_ISSUES_MAX} issue numbers, got ${numbers.length}`,
      )
    }

    if (numbers.length === 0) {
      return []
    }

    const query = buildReadIssuesQuery(numbers)
    const result = await withRetry(
      () =>
        this.octokit.graphql<ReadIssuesQueryResult>(query, {
          owner: this.org,
          repo: this.repo,
        }),
      {
        onRetry: (error, attempt) => {
          console.warn(
            `GitHub readIssues retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )

    const details: IssueDetail[] = []
    for (const [, node] of Object.entries(result.repository)) {
      if (!node || node.__typename !== 'Issue') continue
      const projectFieldValues =
        node.projectItems.nodes[0]?.fieldValues.nodes ?? []
      details.push({
        title: node.title,
        number: node.number,
        state: node.state,
        url: node.url,
        labels: node.labels.nodes.map((l) => l.name),
        assignees: node.assignees.nodes.map((a) => a.login),
        status: extractStatus(projectFieldValues),
        body: node.body.slice(0, bodyLimit),
      })
    }

    return details
  }
}
