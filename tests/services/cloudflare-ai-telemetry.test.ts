import { describe, it, expect } from 'vitest'
import { isStepCount, tool, ToolLoopAgent } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import {
  createCloudflareAITelemetry,
  invokeAgent,
  withConversation,
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

    const chat = recording.find('chat mock-model-id')
    expect(chat?.attributes['error.type']).toBe('Error')
    expect(chat?.exceptions).toEqual([
      { name: 'Error', message: 'gateway down' },
    ])
  })

  it('should identify the agent and conversation on both agent and chat spans', async () => {
    const recording = recordingTracer()

    await withConversation('2026-10-08T16:00:00.000Z', () =>
      invokeAgent(
        'followUp',
        () => runAgent(scriptedModel(['done']), recording.tracer),
        recording.tracer,
      ),
    )

    const identity = {
      'gen_ai.agent.name': 'followUp',
      'gen_ai.agent.id': 'followUp-production',
      'gen_ai.conversation.id': '2026-10-08T16:00:00.000Z',
    }
    expect(recording.find('invoke_agent followUp')?.attributes).toMatchObject(
      identity,
    )
    expect(recording.find('chat mock-model-id')?.attributes).toMatchObject(
      identity,
    )
  })

  it('should put every agent in one conversation under the same session', async () => {
    const recording = recordingTracer()
    const agent = (name: string) =>
      invokeAgent(
        name,
        () => runAgent(scriptedModel(['done']), recording.tracer),
        recording.tracer,
      )

    await withConversation('run-1', async () => {
      await agent('followUp')
      await agent('memoryAgent')
    })

    const conversations = recording.spans
      .filter((span) => span.name.startsWith('invoke_agent'))
      .map((span) => span.attributes['gen_ai.conversation.id'])
    expect(conversations).toEqual(['run-1', 'run-1'])
  })
})
