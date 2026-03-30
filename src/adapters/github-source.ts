import { createPrivateKey } from 'node:crypto'
import type { Octokit } from '@octokit/core'
import type { GitHubSource, IssueFilter } from '../usecases/ports'
import { escapeXml } from './shared'

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
  date?: string
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
  dueDate: string | null
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
                ... on ProjectV2ItemFieldDateValue {
                  date
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

function extractDueDate(fieldValues: FieldValueNode[]): string | null {
  const dateField = fieldValues.find(
    (fv) =>
      fv.__typename === 'ProjectV2ItemFieldDateValue' &&
      fv.field?.name === 'Due',
  )
  return dateField?.date ?? null
}

export function formatIssueToXml(issue: FormattedIssue): string {
  const parts = [
    `<issue number="${issue.number}" state="${issue.state}" url="${issue.url}">`,
    `  <title>${escapeXml(issue.title)}</title>`,
  ]

  if (issue.labels.length > 0) {
    parts.push(`  <labels>${issue.labels.join(', ')}</labels>`)
  }

  if (issue.assignees.length > 0) {
    parts.push(`  <assignees>${issue.assignees.join(', ')}</assignees>`)
  }

  if (issue.status) {
    parts.push(`  <status>${escapeXml(issue.status)}</status>`)
  }

  if (issue.dueDate) {
    parts.push(`  <due-date>${escapeXml(issue.dueDate)}</due-date>`)
  }

  parts.push('</issue>')
  return parts.join('\n')
}

export function ensurePkcs8(privateKey: string): string {
  if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return privateKey
  }

  return createPrivateKey(privateKey).export({
    type: 'pkcs8',
    format: 'pem',
  }) as string
}

export class GitHubSourceAdapter implements GitHubSource {
  constructor(
    private octokit: Octokit,
    private org: string,
    private projectNumber: number,
  ) {}

  async getIssues(filter?: IssueFilter): Promise<string[]> {
    const result = await this.octokit.graphql<ProjectQueryResult>(
      PROJECT_ITEMS_QUERY,
      {
        organization: this.org,
        number: this.projectNumber,
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
          dueDate: extractDueDate(item.fieldValues.nodes),
        }
      })
      .filter((issue) => {
        if (filter?.state && issue.state !== filter.state) return false
        if (filter?.dueDateFrom || filter?.dueDateTo) {
          if (!issue.dueDate) return false
          if (filter.dueDateFrom && issue.dueDate < filter.dueDateFrom)
            return false
          if (filter.dueDateTo && issue.dueDate > filter.dueDateTo) return false
        }
        return true
      })
      .map(formatIssueToXml)
  }
}
