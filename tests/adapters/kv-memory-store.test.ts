import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KVMemoryStoreAdapter } from '../../src/adapters/kv-memory-store'
import type { MemoryEntry } from '../../src/entities/memory-entry'

function createMockKV() {
  const store = new Map<string, string>()

  return {
    store,
    kv: {
      list: vi.fn().mockImplementation(({ prefix }: { prefix: string }) => {
        const keys = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }))
        return { keys }
      }),
      get: vi.fn().mockImplementation((key: string, type?: string) => {
        const value = store.get(key) ?? null
        if (value && type === 'json') return JSON.parse(value)
        return value
      }),
      put: vi.fn().mockImplementation((key: string, value: string) => {
        store.set(key, value)
      }),
      delete: vi.fn().mockImplementation((key: string) => {
        store.delete(key)
      }),
    } as unknown as KVNamespace,
  }
}

describe('KVMemoryStoreAdapter', () => {
  let mock: ReturnType<typeof createMockKV>
  let adapter: KVMemoryStoreAdapter

  beforeEach(() => {
    mock = createMockKV()
    adapter = new KVMemoryStoreAdapter(mock.kv, 32)
  })

  describe('list', () => {
    it('should return empty array when no entries exist', async () => {
      const entries = await adapter.list()
      expect(entries).toEqual([])
    })

    it('should return all stored entries', async () => {
      const entry: MemoryEntry = {
        key: 'topic-1',
        content: 'Ruby Conf planning',
        tag: 'event',
        updatedAt: '2026-03-28T00:00:00.000Z',
      }
      mock.store.set('memory:topic-1', JSON.stringify(entry))

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

      expect(mock.kv.put).toHaveBeenCalledWith(
        'memory:topic-1',
        JSON.stringify(entry),
      )
    })

    it('should reject when entry limit is reached', async () => {
      const limitedAdapter = new KVMemoryStoreAdapter(mock.kv, 2)

      for (let i = 0; i < 2; i++) {
        mock.store.set(
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
      const limitedAdapter = new KVMemoryStoreAdapter(mock.kv, 1)

      mock.store.set(
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
      mock.store.set(
        'memory:topic-1',
        JSON.stringify({
          key: 'topic-1',
          content: 'content',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }),
      )

      await adapter.delete('topic-1')

      expect(mock.kv.delete).toHaveBeenCalledWith('memory:topic-1')
    })
  })

  describe('count', () => {
    it('should return 0 when empty', async () => {
      const count = await adapter.count()
      expect(count).toBe(0)
    })

    it('should return number of stored entries', async () => {
      mock.store.set('memory:a', '{}')
      mock.store.set('memory:b', '{}')

      const count = await adapter.count()
      expect(count).toBe(2)
    })
  })
})
