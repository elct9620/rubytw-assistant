import { env } from 'cloudflare:workers'
import { describe, it, expect, beforeEach } from 'vitest'
import { KVMemoryStoreAdapter } from '../../src/adapters/kv-memory-store'
import type { MemoryEntry } from '../../src/entities/memory-entry'

const KEY_PREFIX = 'memory:'

async function clearKV(kv: KVNamespace) {
  const { keys } = await kv.list({ prefix: KEY_PREFIX })
  await Promise.all(keys.map((k) => kv.delete(k.name)))
}

describe('KVMemoryStoreAdapter', () => {
  let adapter: KVMemoryStoreAdapter

  beforeEach(async () => {
    await clearKV(env.MEMORY_KV)
    adapter = new KVMemoryStoreAdapter(env.MEMORY_KV, 32)
  })

  describe('list', () => {
    it('should return empty array when no entries exist', async () => {
      const entries = await adapter.list()
      expect(entries).toEqual([])
    })

    it.todo(
      'should filter out null entries from stale keys (KV eventual consistency, not reproducible in miniflare)',
    )

    it('should return all stored entries', async () => {
      const entry: MemoryEntry = {
        key: 'topic-1',
        content: 'Ruby Conf planning',
        tag: 'event',
        updatedAt: '2026-03-28T00:00:00.000Z',
      }
      await env.MEMORY_KV.put('memory:topic-1', JSON.stringify(entry))

      const entries = await adapter.list()
      expect(entries).toEqual([entry])
    })
  })

  describe('put', () => {
    it('should store entry with memory: prefix', async () => {
      const entry: MemoryEntry = {
        key: 'topic-1',
        content: 'Ruby Conf planning',
        updatedAt: '2026-03-28T00:00:00.000Z',
      }

      await adapter.put(entry)

      const stored = await env.MEMORY_KV.get<MemoryEntry>(
        'memory:topic-1',
        'json',
      )
      expect(stored).toEqual(entry)
    })

    it('should reject when entry limit is reached', async () => {
      const limitedAdapter = new KVMemoryStoreAdapter(env.MEMORY_KV, 2)

      for (let i = 0; i < 2; i++) {
        await env.MEMORY_KV.put(
          `memory:entry-${i}`,
          JSON.stringify({
            key: `entry-${i}`,
            content: `content ${i}`,
            updatedAt: '2026-03-28T00:00:00.000Z',
          }),
        )
      }

      await expect(
        limitedAdapter.put({
          key: 'entry-new',
          content: 'new content',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }),
      ).rejects.toThrow('Memory store entry limit reached')
    })

    it('should allow overwriting existing entry without counting as new', async () => {
      const limitedAdapter = new KVMemoryStoreAdapter(env.MEMORY_KV, 1)

      await env.MEMORY_KV.put(
        'memory:topic-1',
        JSON.stringify({
          key: 'topic-1',
          content: 'old content',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }),
      )

      await expect(
        limitedAdapter.put({
          key: 'topic-1',
          content: 'updated content',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('delete', () => {
    it('should delete entry by key', async () => {
      await env.MEMORY_KV.put(
        'memory:topic-1',
        JSON.stringify({
          key: 'topic-1',
          content: 'content',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }),
      )

      await adapter.delete('topic-1')

      const stored = await env.MEMORY_KV.get('memory:topic-1')
      expect(stored).toBeNull()
    })
  })

  describe('count', () => {
    it('should return 0 when empty', async () => {
      const count = await adapter.count()
      expect(count).toBe(0)
    })

    it('should return number of stored entries', async () => {
      await env.MEMORY_KV.put('memory:a', '{}')
      await env.MEMORY_KV.put('memory:b', '{}')

      const count = await adapter.count()
      expect(count).toBe(2)
    })
  })
})
