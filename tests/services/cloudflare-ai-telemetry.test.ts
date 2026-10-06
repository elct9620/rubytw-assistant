import { describe, it, expect } from 'vitest'
import { isStepCount, tool, ToolLoopAgent } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import {
  createCloudflareAITelemetry,
  invokeAgent,
} from '../../src/services/cloudflare-ai-telemetry'
import { scriptedModel } from '../helpers/scripted-model'
import { recordingTracer } from '../helpers/recording-tracer'

const echoTool = tool({
  inputSchema: z.object({}),
  execute: async () => 'ok',
})

function runAgent(
  model: MockLanguageModelV4,
  tracer: ReturnType<typeof recordingTracer>['tracer'],
) {
  return new ToolLoopAgent({
    model,
    tools: { echo: echoTool },
    stopWhen: isStepCount(3),
    telemetry: { integrations: [createCloudflareAITelemetry(tracer)] },
  }).generate({ prompt: 'go' })
}

describe('createCloudflareAITelemetry', () => {
  it('should record each model call as a chat span with its usage', async () => {
    const recording = recordingTracer()

    await runAgent(scriptedModel(['done'], 42), recording.tracer)

    const chat = recording.find('chat mock-model-id')
    expect(chat?.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'mock-provider',
      'gen_ai.request.model': 'mock-model-id',
      'gen_ai.usage.input_tokens': 42,
      'gen_ai.usage.output_tokens': 0,
    })
  })

  it('should record each tool run as an execute_tool span', async () => {
    const recording = recordingTracer()

    await runAgent(
      scriptedModel([[{ toolName: 'echo', input: {} }], 'done']),
      recording.tracer,
    )

    const toolSpan = recording.find('execute_tool echo')
    expect(toolSpan?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'echo',
      'gen_ai.tool.type': 'function',
    })
    expect(toolSpan?.attributes['gen_ai.tool.call.id']).toEqual(
      expect.any(String),
    )
  })

  it('should link a chat span to its AI Gateway log', async () => {
    const recording = recordingTracer()
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        response: { headers: { 'cf-aig-log-id': 'log-123' } },
        warnings: [],
      }),
    })

    await runAgent(model, recording.tracer)

    expect(
      recording.find('chat mock-model-id')?.attributes[
        'cloudflare.ai_gateway.log.id'
      ],
    ).toBe('log-123')
  })

  it('should nest model calls and tool runs under the agent that made them', async () => {
    const recording = recordingTracer()

    await invokeAgent(
      'followUp',
      () =>
        runAgent(
          scriptedModel([[{ toolName: 'echo', input: {} }], 'done']),
          recording.tracer,
        ),
      recording.tracer,
    )

    const agent = recording.find('invoke_agent followUp')
    expect(agent?.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'followUp',
    })
    expect(recording.find('chat mock-model-id')?.parent).toBe(agent)
    expect(recording.find('execute_tool echo')?.parent).toBe(agent)
  })

  it('should mark a failed model call as an error and let the failure through', async () => {
    const recording = recordingTracer()
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('gateway down')
      },
    })

    await expect(runAgent(model, recording.tracer)).rejects.toThrow()

    expect(recording.find('chat mock-model-id')?.status).toEqual({
      code: 'error',
      message: 'gateway down',
    })
  })
})
