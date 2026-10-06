import { tool } from 'ai'
import type { ModelMessage, StepResult, StopCondition, ToolSet } from 'ai'
import type { z } from 'zod'

export const SUBMIT_TOOL = 'submit'

export interface ToolCallRecord {
  toolName: string
  input: unknown
}

export type SubmitResult =
  { accepted: true } | { accepted: false; unmet: string[] }

const GITHUB_TOOLS = new Set(['list_issues', 'search_issues', 'read_issues'])
/** `#123`, but not a channel mention, which reaches the AI escaped as `&lt;#123&gt;`. */
const ISSUE_REFERENCE = /(?<!&lt;|\w)#\d+/

export function toolCallsIn(messages: ModelMessage[]): ToolCallRecord[] {
  return messages.flatMap((message) =>
    message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === 'tool-call'
            ? [{ toolName: part.toolName, input: part.input }]
            : [],
        )
      : [],
  )
}

/** The Goal Check: each reason names a check the run has not yet passed. */
export function unmetGoals(
  calls: ToolCallRecord[],
  collectedMessages: string[],
): string[] {
  const called = (name: string) => calls.some((call) => call.toolName === name)
  const unmet: string[] = []

  if (!called('list_memories') || !called('read_memories')) {
    unmet.push(
      'Memory not checked: call list_memories, then read_memories for the slots tracking unfinished items.',
    )
  }

  const searchedPeople = calls.some(
    (call) =>
      call.toolName === 'search_messages' &&
      (call.input as { author?: unknown } | null)?.author === 'people',
  )
  if (!searchedPeople) {
    unmet.push(
      'History not checked: call search_messages with author "people" to find when people last discussed the items.',
    )
  }

  const referencesIssue = collectedMessages.some((m) => ISSUE_REFERENCE.test(m))
  const checkedGitHub = calls.some((call) => GITHUB_TOOLS.has(call.toolName))
  if (referencesIssue && !checkedGitHub) {
    unmet.push(
      'Issues not checked: the messages reference an Issue by #number; check it with list_issues, search_issues, or read_issues.',
    )
  }

  return unmet
}

/** Hands in the list; it is accepted only once the Goal Check passes on the run so far. */
export function createSubmitTool<S extends z.ZodTypeAny>(
  schema: S,
  collectedMessages: string[],
) {
  return tool({
    description:
      "Hand in the follow-up list. It is accepted only when memory, people's history, and any referenced Issue have been checked earlier in this run; otherwise you are told what is missing and must do it, then submit again.",
    inputSchema: schema,
    execute: async (_input, { messages }): Promise<SubmitResult> => {
      const unmet = unmetGoals(toolCallsIn(messages), collectedMessages)
      return unmet.length === 0
        ? { accepted: true }
        : { accepted: false, unmet }
    },
  })
}

export function acceptedSubmission<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[],
): unknown {
  for (const step of steps) {
    for (const result of step.toolResults) {
      if (
        result.toolName === SUBMIT_TOOL &&
        (result.output as SubmitResult).accepted
      ) {
        return result.input
      }
    }
  }
  return undefined
}

export const isSubmissionAccepted: StopCondition<ToolSet> = ({ steps }) =>
  acceptedSubmission(steps) !== undefined

export function tokensSpent<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[],
): number {
  return steps.reduce(
    (total, step) =>
      total +
      (step.usage.totalTokens ??
        (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0)),
    0,
  )
}

export function isOverTokenBudget(budget: number): StopCondition<ToolSet> {
  return ({ steps }) => tokensSpent(steps) > budget
}
