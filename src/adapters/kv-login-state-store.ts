import { injectable, inject } from 'tsyringe'
import type { LoginStateStore } from '../usecases/ports'
import { TOKENS } from '../tokens'

const KEY_PREFIX = 'login:'
const TTL_SECONDS = 600

@injectable()
export class KVLoginStateStoreAdapter implements LoginStateStore {
  constructor(@inject(TOKENS.OAuthKv) private kv: KVNamespace) {}

  async issue(payload: unknown): Promise<string> {
    const state = crypto.randomUUID()
    await this.kv.put(KEY_PREFIX + state, JSON.stringify(payload), {
      expirationTtl: TTL_SECONDS,
    })
    return state
  }

  /** Single use: a state that comes back twice is only honoured once. */
  async consume<T>(state: string): Promise<T | null> {
    const key = KEY_PREFIX + state
    const payload = await this.kv.get<T>(key, 'json')
    if (payload === null) {
      return null
    }
    await this.kv.delete(key)
    return payload
  }
}
