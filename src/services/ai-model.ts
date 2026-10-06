import { createAiGateway } from 'ai-gateway-provider'
import { createOpenAI } from 'ai-gateway-provider/providers/openai'
import type { AiGatewayConfig } from '../tokens'

/** The gateway is shared across services under one bill, so each request names its sender. */
const GATEWAY_METADATA = { service: 'rubytw-assistant' }

export function createAIModel({ gateway, modelId }: AiGatewayConfig) {
  const aigateway = createAiGateway({
    binding: gateway,
    options: { metadata: GATEWAY_METADATA },
  })
  const openai = createOpenAI()
  return aigateway(openai(modelId))
}
