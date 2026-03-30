import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import type { AiGatewayConfig } from '../tokens'

export function createAIModel(config: AiGatewayConfig) {
  const { accountId, gatewayId, apiKey, modelId } = config
  const aigateway = createAiGateway({
    accountId,
    gateway: gatewayId,
    apiKey,
  })
  const unified = createUnified({ supportsStructuredOutputs: true })
  return aigateway(unified(modelId))
}
