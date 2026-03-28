import { describe, it, expect, vi } from 'vitest'
import { AIServiceAdapter } from '../../src/adapters/ai-service'

function createMockAi(response: string | undefined = 'AI summary') {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  }
}

describe('AIServiceAdapter', () => {
  it('should call AI.run with correct model and messages', async () => {
    const ai = createMockAi()
    const adapter = new AIServiceAdapter(ai as unknown as Ai)

    await adapter.generateSummary('issue-1\nmsg-1')

    expect(ai.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.2-3b-instruct',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('issue-1\nmsg-1'),
          }),
        ]),
        max_tokens: 1024,
        temperature: 0.3,
      }),
    )
  })

  it('should return the AI response', async () => {
    const ai = createMockAi('- [待辦] 更新官網')
    const adapter = new AIServiceAdapter(ai as unknown as Ai)

    const result = await adapter.generateSummary('some data')

    expect(result).toBe('- [待辦] 更新官網')
  })

  it('should throw error when response is empty', async () => {
    const ai = createMockAi('')
    const adapter = new AIServiceAdapter(ai as unknown as Ai)

    await expect(adapter.generateSummary('data')).rejects.toThrow(
      'AI service returned empty response',
    )
  })
})
