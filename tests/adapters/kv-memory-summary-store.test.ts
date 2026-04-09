import { env } from 'cloudflare:workers'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  KVMemorySummaryStoreAdapter,
  KV_KEY,
} from '../../src/adapters/kv-memory-summary-store'

describe('KVMemorySummaryStoreAdapter', () => {
  let adapter: KVMemorySummaryStoreAdapter

  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
    adapter = new KVMemorySummaryStoreAdapter(env.MEMORY_KV)
  })

  describe('read', () => {
    it('should return null when no summary exists', async () => {
      const result = await adapter.read()
      expect(result).toBeNull()
    })

    it('should return stored summary', async () => {
      await env.MEMORY_KV.put(KV_KEY, 'existing summary')
      const result = await adapter.read()
      expect(result).toBe('existing summary')
    })
  })

  describe('write', () => {
    it('should persist summary to KV', async () => {
      await adapter.write('new summary')
      const stored = await env.MEMORY_KV.get(KV_KEY, 'text')
      expect(stored).toBe('new summary')
    })

    it('should overwrite existing summary', async () => {
      await adapter.write('first')
      await adapter.write('second')
      const stored = await env.MEMORY_KV.get(KV_KEY, 'text')
      expect(stored).toBe('second')
    })
  })
})
