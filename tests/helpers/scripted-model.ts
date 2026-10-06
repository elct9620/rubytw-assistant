import { MockLanguageModelV4 } from 'ai/test'

export interface ScriptedCall {
  toolName: string
  input: unknown
}

/**
 * A model that answers each step with the next scripted turn: a list of tool
 * calls, or a final text. The last turn repeats once the script runs out.
 */
export function scriptedModel(
  turns: (ScriptedCall[] | string)[],
  tokensPerStep = 10,
) {
  let step = 0
  let nextId = 0
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = turns[Math.min(step++, turns.length - 1)]
      const content =
        typeof turn === 'string'
          ? [{ type: 'text' as const, text: turn }]
          : turn.map((call) => ({
              type: 'tool-call' as const,
              toolCallId: `call-${nextId++}`,
              toolName: call.toolName,
              input: JSON.stringify(call.input),
            }))
      return {
        content,
        finishReason: {
          unified: typeof turn === 'string' ? 'stop' : 'tool-calls',
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: tokensPerStep,
            noCache: tokensPerStep,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })
}
