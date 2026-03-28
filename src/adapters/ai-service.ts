import { generateText } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import type { AIService } from '../usecases/generate-summary'

const ACCOUNT_ID = '614fcd230e7a893b205fd36259d9aff3'
const GATEWAY_ID = 'rubytw-assistant'

const SYSTEM_PROMPT = `你是 Ruby Taiwan 社群的營運助手。根據提供的資料，產生一份繁體中文的待辦清單格式摘要。

規則：
- 每項以 "- [狀態] 描述" 格式呈現
- 狀態包含：待辦、進行中、完成
- 最多 30 項
- 優先列出需要關注的事項`

export class AIServiceAdapter implements AIService {
  constructor(
    private apiKey: string,
    private modelId: string,
  ) {}

  async generateSummary(data: string): Promise<string> {
    const aigateway = createAiGateway({
      accountId: ACCOUNT_ID,
      gateway: GATEWAY_ID,
      apiKey: this.apiKey,
    })
    const unified = createUnified()

    const { text } = await generateText({
      model: aigateway(unified(this.modelId)),
      system: SYSTEM_PROMPT,
      prompt: data,
      maxTokens: 1024,
      temperature: 0.3,
    })

    if (!text) {
      throw new Error('AI service returned empty response')
    }

    return text
  }
}
