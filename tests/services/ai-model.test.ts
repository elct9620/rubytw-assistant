import { describe, it, expect, vi } from 'vitest'

const mockCreateUnified = vi.fn().mockReturnValue(() => 'mock-model')
vi.mock('ai-gateway-provider/providers/unified', () => ({
  createUnified: (...args: unknown[]) => mockCreateUnified(...args),
}))

vi.mock('ai-gateway-provider', () => ({
  createAiGateway: () => (model: unknown) => model,
}))

describe('createAIModel', () => {
  it('should enable supportsStructuredOutputs on unified provider', async () => {
    const { createAIModel } = await import('../../src/services/ai-model')

    createAIModel({
      accountId: 'test-account',
      gatewayId: 'test-gateway',
      apiKey: 'test-key',
      modelId: 'openai/gpt-4.1-mini',
    })

    expect(mockCreateUnified).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsStructuredOutputs: true,
      }),
    )
  })
})
