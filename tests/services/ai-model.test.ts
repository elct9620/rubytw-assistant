import { describe, it, expect, vi } from 'vitest'

const mockOpenAIProvider = vi.fn().mockReturnValue('mock-model')
const mockCreateOpenAI = vi.fn().mockReturnValue(mockOpenAIProvider)
vi.mock('ai-gateway-provider/providers/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}))

const mockAiGateway = vi.fn().mockImplementation((model: unknown) => model)
vi.mock('ai-gateway-provider', () => ({
  createAiGateway: () => mockAiGateway,
}))

describe('createAIModel', () => {
  it('should create model using OpenAI Responses API via AI Gateway', async () => {
    const { createAIModel } = await import('../../src/services/ai-model')

    const model = createAIModel({
      accountId: 'test-account',
      gatewayId: 'test-gateway',
      apiKey: 'test-key',
      modelId: 'test-model',
    })

    expect(mockCreateOpenAI).toHaveBeenCalled()
    expect(mockOpenAIProvider).toHaveBeenCalledWith('test-model')
    expect(mockAiGateway).toHaveBeenCalledWith('mock-model')
    expect(model).toBe('mock-model')
  })
})
