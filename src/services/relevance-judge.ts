import { generateText, Output } from 'ai'
import type { LanguageModel, Telemetry } from 'ai'
import { z } from 'zod'
import type { RelevanceJudge } from './evidence-check'
import RELEVANCE_JUDGE_PROMPT from '../prompts/relevance-judge.md'

const FUNCTION_ID = 'relevanceJudge'

const VerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      item: z.number().int().describe('the number of the item judged'),
      relevant: z.boolean(),
      reason: z
        .string()
        .describe('when not relevant, what the quotes are about instead'),
    }),
  ),
})

/** Judges every item of a list in one model call. */
export function createRelevanceJudge(
  model: LanguageModel,
  telemetry: Telemetry[],
): RelevanceJudge {
  return async (questions) => {
    const prompt = questions
      .map(
        (q, i) =>
          `${i + 1}. ${q.description}\n${q.quotes.map((quote) => `> ${quote}`).join('\n')}`,
      )
      .join('\n\n')
    const { output } = await generateText({
      model,
      system: RELEVANCE_JUDGE_PROMPT,
      prompt,
      output: Output.object({ schema: VerdictsSchema }),
      providerOptions: { openai: { reasoningEffort: 'low' } },
      telemetry: { integrations: telemetry, functionId: FUNCTION_ID },
    })
    return questions.map((_, i) => {
      const verdict = output.verdicts.find((v) => v.item === i + 1)
      return verdict
        ? { relevant: verdict.relevant, reason: verdict.reason }
        : { relevant: false, reason: 'no judgement was returned' }
    })
  }
}
