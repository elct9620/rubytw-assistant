import { describe, it, expect, vi } from 'vitest'

const mockCreateOpenAI = vi.fn().mockReturnValue(() => 'mock-model')
vi.mock('ai-gateway-provider/providers/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}))

vi.mock('ai-gateway-provider', () => ({
  createAiGateway: () => (model: unknown) => model,
}))

describe('createAIModel', () => {
  it('should create model using OpenAI provider via AI Gateway', async () => {
    const { createAIModel } = await import('../../src/services/ai-model')

    createAIModel({
      accountId: 'test-account',
      gatewayId: 'test-gateway',
      apiKey: 'test-key',
      modelId: 'gpt-5.4-nano',
    })

    expect(mockCreateOpenAI).toHaveBeenCalled()
  })
})
