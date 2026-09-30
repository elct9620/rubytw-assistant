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
}

interface ProjectItemNode {
  content: IssueNode | null
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

const SEARCH_ISSUES_MAX = 20

const ISSUE_OVERVIEW_FIELDS = `
  __typename
  title
  number
  state
  url
  labels(first: 5) { nodes { name } }
  assignees(first: 5) { nodes { login } }
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

const READ_ISSUES_RECENT_COMMENTS = 5

const ISSUE_DETAIL_FIELDS = `
  body
  updatedAt
  comments(last: ${READ_ISSUES_RECENT_COMMENTS}) {
    nodes {
      author { login }
      createdAt
      body
    }
  }
`

function buildReadIssuesQuery(numbers: number[]): string {
  const aliases = numbers
    .map(
      (n, i) =>
        `issue${i}: issue(number: ${n}) { ${ISSUE_OVERVIEW_FIELDS} ${ISSUE_DETAIL_FIELDS} }`,
    )
    .join('\n')
  return `
    query ($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        ${aliases}
      }
    }
  `
}

const SEARCH_ISSUES_QUERY = `
  query ($searchQuery: String!) {
    search(query: $searchQuery, type: ISSUE, first: ${SEARCH_ISSUES_MAX}) {
      nodes {
        ... on Issue {
          ${ISSUE_OVERVIEW_FIELDS}
          repository { nameWithOwner }
        }
      }
    }
  }
`

/** An issue reached directly, which carries its own place on the board. */
interface IssueOverviewNode extends IssueNode {
  projectItems: {
    nodes: {
      fieldValues: { nodes: FieldValueNode[] }
    }[]
  }
}

interface ReadIssueNode extends IssueOverviewNode {
  body: string
  updatedAt: string
  comments: {
    nodes: {
      author: { login: string } | null
      createdAt: string
      body: string
    }[]
  }
}

interface SearchIssueNode extends IssueOverviewNode {
  repository: { nameWithOwner: string }
}

interface SearchIssuesQueryResult {
  search: { nodes: (Partial<SearchIssueNode> | null)[] }
}

function toOverview(node: IssueOverviewNode): IssueOverview {
  return {
    title: node.title,
    number: node.number,
    state: node.state,
    url: node.url,
    labels: node.labels.nodes.map((l) => l.name),
    assignees: node.assignees.nodes.map((a) => a.login),
    status: extractStatus(node.projectItems.nodes[0]?.fieldValues.nodes ?? []),
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
    const result = await this.graphql<ProjectQueryResult>(
      'listIssues',
      PROJECT_ITEMS_QUERY,
      { organization: this.org, number: this.projectNumber },
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

  async searchIssues(query: string): Promise<IssueOverview[]> {
    const result = await this.graphql<SearchIssuesQueryResult>(
      'searchIssues',
      SEARCH_ISSUES_QUERY,
      { searchQuery: `repo:${this.org}/${this.repo} is:issue ${query}` },
    )

    // A `repo:` qualifier inside the query widens the search rather than
    // replacing ours, so the scope is enforced on what comes back.
    const scope = `${this.org}/${this.repo}`.toLowerCase()
    return result.search.nodes
      .filter(
        (node): node is SearchIssueNode =>
          node?.__typename === 'Issue' &&
          node.repository?.nameWithOwner.toLowerCase() === scope,
      )
      .map(toOverview)
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

    const result = await this.graphql<ReadIssuesQueryResult>(
      'readIssues',
      buildReadIssuesQuery(numbers),
      { owner: this.org, repo: this.repo },
    )

    const details: IssueDetail[] = []
    for (const node of Object.values(result.repository)) {
      if (!node || node.__typename !== 'Issue') continue
      details.push({
        ...toOverview(node),
        body: node.body.slice(0, bodyLimit),
        updatedAt: node.updatedAt,
        comments: node.comments.nodes.map((comment) => ({
          author: comment.author?.login ?? null,
          createdAt: comment.createdAt,
          body: comment.body.slice(0, bodyLimit),
        })),
      })
    }

    return details
  }

  private graphql<T>(
    label: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    return withRetry(() => this.octokit.graphql<T>(query, variables), {
      onRetry: (error, attempt) => {
        console.warn(
          `GitHub ${label} retry ${attempt}:`,
          error instanceof Error ? error.message : error,
        )
      },
    })
  }
}
