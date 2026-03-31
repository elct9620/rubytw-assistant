import { describe, it, expect, vi } from 'vitest'
import {
  GitHubSourceAdapter,
  formatIssueToXml,
} from '../../src/adapters/github-source'

function makeProjectResponse(
  items: {
    content: unknown
    fieldValues?: { nodes: unknown[] }
  }[],
) {
  return {
    organization: {
      projectV2: {
        items: {
          nodes: items.map((item) => ({
            content: item.content,
            fieldValues: item.fieldValues ?? { nodes: [] },
          })),
        },
      },
    },
  }
}

function makeIssueContent(overrides?: {
  title?: string
  number?: number
  state?: string
  url?: string
  labels?: string[]
  assignees?: string[]
}) {
  return {
    __typename: 'Issue',
    title: overrides?.title ?? 'Test Issue',
    number: overrides?.number ?? 1,
    state: overrides?.state ?? 'OPEN',
    url: overrides?.url ?? 'https://github.com/rubytw/conf/issues/1',
    labels: {
      nodes: (overrides?.labels ?? []).map((name) => ({ name })),
    },
    assignees: {
      nodes: (overrides?.assignees ?? []).map((login) => ({ login })),
    },
  }
}

function createAdapter(graphql: ReturnType<typeof vi.fn>) {
  return new GitHubSourceAdapter(
    { graphql } as unknown as import('@octokit/core').Octokit,
    'rubytw',
    1,
  )
}

describe('GitHubSourceAdapter', () => {
  it('should fetch issues from GitHub Project and format as XML', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeProjectResponse([
        {
          content: makeIssueContent({
            title: '更新官網',
            number: 42,
            state: 'OPEN',
            url: 'https://github.com/rubytw/conf/issues/42',
            labels: ['bug', 'enhancement'],
            assignees: ['alice', 'bob'],
          }),
          fieldValues: {
            nodes: [
              {
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                name: 'In Progress',
                field: { name: 'Status' },
              },
            ],
          },
        },
      ]),
    )

    const adapter = createAdapter(graphql)
    const result = await adapter.getIssues()

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('<issue number="42"')
    expect(result[0]).toContain('state="OPEN"')
    expect(result[0]).toContain('<title>更新官網</title>')
    expect(result[0]).toContain('<labels>bug, enhancement</labels>')
    expect(result[0]).toContain('<assignees>alice, bob</assignees>')
    expect(result[0]).toContain('<status>In Progress</status>')
  })

  it('should pass correct variables to GraphQL query', async () => {
    const graphql = vi.fn().mockResolvedValue(makeProjectResponse([]))

    const adapter = createAdapter(graphql)
    await adapter.getIssues()

    expect(graphql).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        organization: 'rubytw',
        number: 1,
      }),
    )
  })

  it('should return empty array when project has no items', async () => {
    const graphql = vi.fn().mockResolvedValue(makeProjectResponse([]))

    const adapter = createAdapter(graphql)
    const result = await adapter.getIssues()

    expect(result).toEqual([])
  })

  it('should skip non-Issue items (PRs, DraftIssues, null)', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeProjectResponse([
        {
          content: makeIssueContent({ title: 'Real Issue', number: 1 }),
        },
        {
          content: {
            __typename: 'PullRequest',
            title: 'Some PR',
          },
        },
        {
          content: {
            __typename: 'DraftIssue',
            title: 'Draft',
            body: 'draft body',
          },
        },
        {
          content: null,
        },
      ]),
    )

    const adapter = createAdapter(graphql)
    const result = await adapter.getIssues()

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('<title>Real Issue</title>')
  })

  it('should throw error when GraphQL request fails', async () => {
    const graphql = vi.fn().mockRejectedValue(new Error('GraphQL error'))

    const adapter = createAdapter(graphql)
    await expect(adapter.getIssues()).rejects.toThrow('GraphQL error')
  })

  it('should filter issues by state when filter is provided', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeProjectResponse([
        {
          content: makeIssueContent({ title: 'Open Issue', state: 'OPEN' }),
        },
        {
          content: makeIssueContent({ title: 'Closed Issue', state: 'CLOSED' }),
        },
      ]),
    )

    const adapter = createAdapter(graphql)
    const result = await adapter.getIssues({ state: 'OPEN' })

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('state="OPEN"')
    expect(result[0]).toContain('<title>Open Issue</title>')
  })

  it('should return all issues when no filter is provided', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeProjectResponse([
        {
          content: makeIssueContent({ title: 'Open', state: 'OPEN' }),
        },
        {
          content: makeIssueContent({ title: 'Closed', state: 'CLOSED' }),
        },
      ]),
    )

    const adapter = createAdapter(graphql)
    const result = await adapter.getIssues()

    expect(result).toHaveLength(2)
  })
})

describe('formatIssueToXml', () => {
  it('should format issue with all fields', () => {
    const xml = formatIssueToXml({
      title: 'Test Issue',
      number: 10,
      state: 'OPEN',
      url: 'https://github.com/rubytw/conf/issues/10',
      labels: ['bug'],
      assignees: ['alice'],
      status: 'Todo',
    })

    expect(xml).toContain('<issue number="10"')
    expect(xml).toContain('state="OPEN"')
    expect(xml).toContain('url="https://github.com/rubytw/conf/issues/10"')
    expect(xml).toContain('<title>Test Issue</title>')
    expect(xml).toContain('<labels>bug</labels>')
    expect(xml).toContain('<assignees>alice</assignees>')
    expect(xml).toContain('<status>Todo</status>')
  })

  it('should omit labels, assignees, and status when empty or null', () => {
    const xml = formatIssueToXml({
      title: 'No Labels',
      number: 1,
      state: 'OPEN',
      url: 'https://github.com/rubytw/conf/issues/1',
      labels: [],
      assignees: [],
      status: null,
    })

    expect(xml).not.toContain('<labels>')
    expect(xml).not.toContain('<assignees>')
    expect(xml).not.toContain('<status>')
  })

  it('should escape XML special characters', () => {
    const xml = formatIssueToXml({
      title: 'Fix <script> & "quotes"',
      number: 1,
      state: 'OPEN',
      url: 'https://github.com/rubytw/conf/issues/1',
      labels: [],
      assignees: [],
      status: null,
    })

    expect(xml).toContain(
      '<title>Fix &lt;script&gt; &amp; &quot;quotes&quot;</title>',
    )
  })
})
