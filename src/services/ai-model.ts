import { createAiGateway } from 'ai-gateway-provider'
import { createOpenAI } from 'ai-gateway-provider/providers/openai'
import type { AiGatewayConfig } from '../tokens'

export function createAIModel(config: AiGatewayConfig) {
  const { accountId, gatewayId, apiKey, modelId } = config
  const aigateway = createAiGateway({
    accountId,
    gateway: gatewayId,
    apiKey,
  })
  const openai = createOpenAI()
  return aigateway(openai(modelId))
}
