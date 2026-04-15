import { describe, it, expect, vi } from 'vitest'
import {
  GitHubSourceAdapter,
  formatIssueToXml,
} from '../../src/adapters/github-source'
import type { IssueDetail } from '../../src/usecases/ports'

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

function createAdapterWithRepo(graphql: ReturnType<typeof vi.fn>) {
  return new GitHubSourceAdapter(
    { graphql } as unknown as import('@octokit/core').Octokit,
    'rubytw',
    1,
    'conf',
  )
}

function makeReadIssueNode(overrides?: {
  title?: string
  number?: number
  state?: string
  url?: string
  labels?: string[]
  assignees?: string[]
  body?: string
  status?: string | null
}) {
  const status = overrides?.status ?? null
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
    body: overrides?.body ?? '',
    projectItems: {
      nodes:
        status !== null
          ? [
              {
                fieldValues: {
                  nodes: [
                    {
                      __typename: 'ProjectV2ItemFieldSingleSelectValue',
                      name: status,
                      field: { name: 'Status' },
                    },
                  ],
                },
              },
            ]
          : [],
    },
  }
}

function makeReadIssuesResponse(
  issues: Record<string, ReturnType<typeof makeReadIssueNode> | null>,
) {
  return { repository: issues }
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
    const result = await adapter.listIssues()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      number: 42,
      state: 'OPEN',
      title: '更新官網',
      labels: ['bug', 'enhancement'],
      assignees: ['alice', 'bob'],
      status: 'In Progress',
    })
  })

  it('should pass correct variables to GraphQL query', async () => {
    const graphql = vi.fn().mockResolvedValue(makeProjectResponse([]))

    const adapter = createAdapter(graphql)
    await adapter.listIssues()

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
    const result = await adapter.listIssues()

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
    const result = await adapter.listIssues()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: 'Real Issue' })
  })

  it('should throw error after retries when GraphQL request fails', async () => {
    const graphql = vi.fn().mockRejectedValue(new Error('GraphQL error'))

    const adapter = createAdapter(graphql)
    await expect(adapter.listIssues()).rejects.toThrow('GraphQL error')
    expect(graphql).toHaveBeenCalledTimes(3)
  })

  it('should succeed after transient failure', async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(
        makeProjectResponse([
          { content: makeIssueContent({ title: 'Recovered' }) },
        ]),
      )

    const adapter = createAdapter(graphql)
    const result = await adapter.listIssues()

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: 'Recovered' })
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
    const result = await adapter.listIssues('OPEN')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ state: 'OPEN', title: 'Open Issue' })
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
    const result = await adapter.listIssues()

    expect(result).toHaveLength(2)
  })

  it('should return at most 50 items (fixed query constraint)', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      content: makeIssueContent({ title: `Issue ${i + 1}`, number: i + 1 }),
    }))
    const graphql = vi.fn().mockResolvedValue(makeProjectResponse(items))

    const adapter = createAdapter(graphql)
    const result = await adapter.listIssues()

    expect(result).toHaveLength(50)
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('items(first: 50)'),
      expect.any(Object),
    )
  })
})

describe('readIssues', () => {
  it('should return issue details for each requested number', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeReadIssuesResponse({
        issue0: makeReadIssueNode({
          title: 'First Issue',
          number: 10,
          state: 'OPEN',
          url: 'https://github.com/rubytw/conf/issues/10',
          labels: ['bug'],
          assignees: ['alice'],
          body: 'issue body',
          status: 'In Progress',
        }),
        issue1: makeReadIssueNode({
          title: 'Second Issue',
          number: 20,
          state: 'CLOSED',
          url: 'https://github.com/rubytw/conf/issues/20',
          labels: [],
          assignees: [],
          body: 'another body',
          status: null,
        }),
      }),
    )

    const adapter = createAdapterWithRepo(graphql)
    const result = await adapter.readIssues([10, 20], 1000)

    expect(result).toHaveLength(2)
    const first = result.find((i: IssueDetail) => i.number === 10)!
    expect(first).toMatchObject({
      title: 'First Issue',
      number: 10,
      state: 'OPEN',
      labels: ['bug'],
      assignees: ['alice'],
      status: 'In Progress',
      body: 'issue body',
    })
    const second = result.find((i: IssueDetail) => i.number === 20)!
    expect(second).toMatchObject({ number: 20, status: null })
  })

  it('should truncate body to bodyLimit characters', async () => {
    const longBody = 'a'.repeat(200)
    const graphql = vi.fn().mockResolvedValue(
      makeReadIssuesResponse({
        issue0: makeReadIssueNode({ number: 1, body: longBody }),
      }),
    )

    const adapter = createAdapterWithRepo(graphql)
    const result = await adapter.readIssues([1], 100)

    expect(result[0].body).toBe(longBody.slice(0, 100))
    expect(result[0].body).toHaveLength(100)
  })

  it('should return body unchanged when within bodyLimit', async () => {
    const shortBody = 'short body'
    const graphql = vi.fn().mockResolvedValue(
      makeReadIssuesResponse({
        issue0: makeReadIssueNode({ number: 1, body: shortBody }),
      }),
    )

    const adapter = createAdapterWithRepo(graphql)
    const result = await adapter.readIssues([1], 1000)

    expect(result[0].body).toBe(shortBody)
  })

  it('should throw before any network call when more than 10 numbers are given', async () => {
    const graphql = vi.fn()
    const numbers = Array.from({ length: 11 }, (_, i) => i + 1)

    const adapter = createAdapterWithRepo(graphql)

    await expect(adapter.readIssues(numbers, 500)).rejects.toThrow(/at most 10/)
    expect(graphql).not.toHaveBeenCalled()
  })

  it('should return empty array without a network call for empty input', async () => {
    const graphql = vi.fn()

    const adapter = createAdapterWithRepo(graphql)
    const result = await adapter.readIssues([], 500)

    expect(result).toEqual([])
    expect(graphql).not.toHaveBeenCalled()
  })

  it('should omit issues where GraphQL returns null', async () => {
    const graphql = vi.fn().mockResolvedValue(
      makeReadIssuesResponse({
        issue0: makeReadIssueNode({ title: 'Exists', number: 1 }),
        issue1: null,
        issue2: makeReadIssueNode({ title: 'Also Exists', number: 3 }),
      }),
    )

    const adapter = createAdapterWithRepo(graphql)
    const result = await adapter.readIssues([1, 2, 3], 500)

    expect(result).toHaveLength(2)
    expect(result.map((i: IssueDetail) => i.number)).toEqual(
      expect.arrayContaining([1, 3]),
    )
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

  it('should escape XML special characters in labels, assignees, and url', () => {
    const xml = formatIssueToXml({
      title: 'Test',
      number: 1,
      state: 'OPEN',
      url: 'https://example.com/?a=1&b="2"',
      labels: ['bug <hot>', 'needs "triage"'],
      assignees: ['alice&bob'],
      status: null,
    })

    expect(xml).toContain('url="https://example.com/?a=1&amp;b=&quot;2&quot;"')
    expect(xml).toContain(
      '<labels>bug &lt;hot&gt;, needs &quot;triage&quot;</labels>',
    )
    expect(xml).toContain('<assignees>alice&amp;bob</assignees>')
  })
})
