import { describe, it, expect } from 'vitest'
import { generateText } from 'ai'
import { createAIModel } from '../../src/services/ai-model'

interface GatewayRequest {
  provider: string
  headers: Record<string, string>
  query: { model?: string }
}

function recordingGateway() {
  const requests: GatewayRequest[] = []
  const gateway = {
    run: async (data: unknown) => {
      requests.push(...(data as GatewayRequest[]))
      return new Response('{}', { status: 500 })
    },
  } as unknown as AiGateway
  return { gateway, requests }
}

describe('createAIModel', () => {
  it('should send the request through the AI binding tagged with this service', async () => {
    const { gateway, requests } = recordingGateway()

    await generateText({
      model: createAIModel({ gateway, modelId: 'test-model' }),
      prompt: 'hello',
      maxRetries: 0,
    }).catch(() => undefined)

    expect(requests).toHaveLength(1)
    expect(requests[0].provider).toBe('openai')
    expect(requests[0].query.model).toBe('test-model')
    expect(JSON.parse(requests[0].headers['cf-aig-metadata'])).toEqual({
      service: 'rubytw-assistant',
    })
  })
})
