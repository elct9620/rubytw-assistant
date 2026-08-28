import * as ai from 'ai'
import { wrapAISDK } from 'agents/observability/ai'

/**
 * Payload storage is left off: Langfuse already holds the prompts and tool
 * calls, and storing them again would put the community's messages in a
 * second place.
 */
export const { generateText } = wrapAISDK(ai)
