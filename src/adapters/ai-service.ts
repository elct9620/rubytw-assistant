import type { AIService } from '../usecases/generate-summary'

const MODEL = '@cf/meta/llama-3.2-3b-instruct' as const

const SYSTEM_PROMPT = `你是 Ruby Taiwan 社群的營運助手。根據提供的資料，產生一份繁體中文的待辦清單格式摘要。

規則：
- 每項以 "- [狀態] 描述" 格式呈現
- 狀態包含：待辦、進行中、完成
- 最多 30 項
- 優先列出需要關注的事項`

export class AIServiceAdapter implements AIService {
  constructor(private ai: Ai) {}

  async generateSummary(data: string): Promise<string> {
    const result = await this.ai.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: data },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    })

    if (!result.response) {
      throw new Error('AI service returned empty response')
    }

    return result.response
  }
}
