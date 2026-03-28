import { describe, it, expect, vi } from 'vitest'
import { AIServiceAdapter } from '../../src/adapters/ai-service'

const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

describe('AIServiceAdapter', () => {
  it('should call generateText with AI Gateway unified model', async () => {
    mockGenerateText.mockResolvedValue({ text: '- [待辦] 更新官網' })
    const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

    await adapter.generateSummary('issue-1\nmsg-1')

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.anything(),
        system: expect.stringContaining('待辦清單'),
        prompt: 'issue-1\nmsg-1',
        maxTokens: 1024,
        temperature: 0.3,
      }),
    )
  })

  it('should return the generated text', async () => {
    mockGenerateText.mockResolvedValue({ text: '- [待辦] 更新官網' })
    const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

    const result = await adapter.generateSummary('some data')

    expect(result).toBe('- [待辦] 更新官網')
  })

  it('should throw error when text is empty', async () => {
    mockGenerateText.mockResolvedValue({ text: '' })
    const adapter = new AIServiceAdapter('test-token', 'openai/gpt-4.1-mini')

    await expect(adapter.generateSummary('data')).rejects.toThrow(
      'AI service returned empty response',
    )
  })
})
