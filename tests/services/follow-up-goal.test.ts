import { describe, it, expect } from 'vitest'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import {
  acceptedSubmission,
  createSubmitTool,
  isOverTokenBudget,
  isSubmissionAccepted,
  SUBMIT_TOOL,
  unmetGoals,
  type SubmitResult,
} from '../../src/services/follow-up-goal'
import { scriptedModel, type ScriptedCall } from '../helpers/scripted-model'

const ListSchema = z.object({ items: z.array(z.string()) })

const noop = tool({
  inputSchema: z.looseObject({}),
  execute: async () => ({}),
})

const CHECKS: ScriptedCall[] = [
  { toolName: 'list_memories', input: {} },
  { toolName: 'read_memories', input: { indices: [0] } },
  { toolName: 'search_messages', input: { author: 'people' } },
]
const SUBMIT: ScriptedCall = {
  toolName: SUBMIT_TOOL,
  input: { items: ['寄出贊助報告'] },
}

function runFollowUp(
  turns: (ScriptedCall[] | string)[],
  collected: string[],
  budget = 1_000,
) {
  return generateText({
    model: scriptedModel(turns, 100),
    prompt: 'follow up',
    tools: {
      list_memories: noop,
      read_memories: noop,
      search_messages: noop,
      list_issues: noop,
      [SUBMIT_TOOL]: createSubmitTool(ListSchema, collected),
    },
    stopWhen: [isSubmissionAccepted, isOverTokenBudget(budget)],
  })
}

const submitResults = (result: Awaited<ReturnType<typeof runFollowUp>>) =>
  result.steps.flatMap((step) =>
    step.toolResults
      .filter((r) => r.toolName === SUBMIT_TOOL)
      .map((r) => r.output as SubmitResult),
  )

describe('Follow-up Goal Check', () => {
  it('should send a premature submission back with what is missing, then accept it once checked', async () => {
    const result = await runFollowUp([[SUBMIT], CHECKS, [SUBMIT]], [])

    const [refused, accepted] = submitResults(result)
    expect(refused).toEqual({
      accepted: false,
      unmet: [expect.stringMatching(/^Memory/)],
    })
    expect(accepted).toEqual({ accepted: true })
    expect(acceptedSubmission(result.steps)).toEqual({
      items: ['寄出贊助報告'],
    })
  })

  it('should accept a list without any message search once memory was read', async () => {
    const result = await runFollowUp([CHECKS.slice(0, 2), [SUBMIT]], [])

    expect(submitResults(result)[0]).toEqual({ accepted: true })
  })

  it('should require an Issue lookup when the collected messages reference one', async () => {
    const collected = ['[2026-10-05] Kasa: #42 的贊助報告還沒寄']

    const refused = await runFollowUp([CHECKS, [SUBMIT]], collected)
    const accepted = await runFollowUp(
      [[...CHECKS, { toolName: 'list_issues', input: {} }], [SUBMIT]],
      collected,
    )

    expect(submitResults(refused)[0]).toEqual({
      accepted: false,
      unmet: [expect.stringMatching(/^Issues/)],
    })
    expect(submitResults(accepted)[0]).toEqual({ accepted: true })
  })

  it('should stop without an accepted list once the token budget is spent', async () => {
    const result = await runFollowUp([[SUBMIT]], [], 250)

    expect(result.steps).toHaveLength(3)
    expect(acceptedSubmission(result.steps)).toBeUndefined()
  })

  it('should not take a channel mention for an Issue reference', () => {
    const unmet = unmetGoals(
      CHECKS.map(({ toolName, input }) => ({ toolName, input })),
      ['[2026-10-05] Kasa: 請到 &lt;#1245260528251703346&gt; 討論'],
    )

    expect(unmet).toEqual([])
  })

  it('should not count listing memory without reading it as memory checked', () => {
    const unmet = unmetGoals(
      [{ toolName: 'list_memories', input: {} }],
      [],
    )

    expect(unmet).toEqual([expect.stringMatching(/^Memory/)])
  })

  it('should leave the issue check satisfied when no message references an Issue', () => {
    const unmet = unmetGoals(
      CHECKS.map(({ toolName, input }) => ({ toolName, input })),
      ['今天討論了場地'],
    )

    expect(unmet).toEqual([])
  })
})
