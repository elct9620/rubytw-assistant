import type { StepResult, StopCondition, ToolSet } from 'ai'

/** The tool an agent hands its result in through; the result decides whether the run ends. */
export const SUBMIT_TOOL = 'submit'

export interface Submission {
  accepted: boolean
}

/** The input of the first submission the run accepted, or undefined when none was. */
export function acceptedSubmission<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[],
): unknown {
  for (const step of steps) {
    for (const result of step.toolResults) {
      if (
        result.toolName === SUBMIT_TOOL &&
        (result.output as Submission).accepted
      ) {
        return result.input
      }
    }
  }
  return undefined
}

export const isSubmissionAccepted: StopCondition<ToolSet> = ({ steps }) =>
  acceptedSubmission(steps) !== undefined
