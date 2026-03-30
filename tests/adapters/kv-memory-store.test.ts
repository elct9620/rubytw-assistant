import { env } from 'cloudflare:workers'
import { describe, it, expect, beforeEach } from 'vitest'
import { KVMemoryStoreAdapter } from '../../src/adapters/kv-memory-store'

const KEY_PREFIX = 'memory:'
const ENTRY_LIMIT = 4
const DESCRIPTION_LIMIT = 128

async function clearKV(kv: KVNamespace) {
  const { keys } = await kv.list({ prefix: KEY_PREFIX })
  await Promise.all(keys.map((k) => kv.delete(k.name)))
}

describe('KVMemoryStoreAdapter', () => {
  let adapter: KVMemoryStoreAdapter

  beforeEach(async () => {
    await clearKV(env.MEMORY_KV)
    adapter = new KVMemoryStoreAdapter(
      env.MEMORY_KV,
      ENTRY_LIMIT,
      DESCRIPTION_LIMIT,
    )
  })

  describe('list', () => {
    it('should return all slots with empty descriptions when no entries exist', async () => {
      const slots = await adapter.list()
      expect(slots).toHaveLength(ENTRY_LIMIT)
      expect(slots).toEqual([
        { index: 0, description: '' },
        { index: 1, description: '' },
        { index: 2, description: '' },
        { index: 3, description: '' },
      ])
    })

    it('should return descriptions for occupied slots', async () => {
      await env.MEMORY_KV.put(
        'memory:1',
        JSON.stringify({
          description: 'ongoing tasks',
          content: 'task details',
        }),
      )

      const slots = await adapter.list()
      expect(slots[1]).toEqual({ index: 1, description: 'ongoing tasks' })
      expect(slots[0]).toEqual({ index: 0, description: '' })
    })
  })

  describe('read', () => {
    it('should return empty strings for unused slots', async () => {
      const entries = await adapter.read([0, 2])
      expect(entries).toEqual([
        { index: 0, description: '', content: '' },
        { index: 2, description: '', content: '' },
      ])
    })

    it('should return full content for occupied slots', async () => {
      await env.MEMORY_KV.put(
        'memory:0',
        JSON.stringify({
          description: 'ongoing tasks',
          content: 'task details here',
        }),
      )

      const entries = await adapter.read([0])
      expect(entries).toEqual([
        {
          index: 0,
          description: 'ongoing tasks',
          content: 'task details here',
        },
      ])
    })
  })

  describe('update', () => {
    it('should store entry at specified index', async () => {
      await adapter.update(0, 'test description', 'test content')

      const stored = await env.MEMORY_KV.get('memory:0', 'json')
      expect(stored).toEqual({
        description: 'test description',
        content: 'test content',
      })
    })

    it('should overwrite existing entry', async () => {
      await adapter.update(0, 'old', 'old content')
      await adapter.update(0, 'new', 'new content')

      const stored = await env.MEMORY_KV.get('memory:0', 'json')
      expect(stored).toEqual({ description: 'new', content: 'new content' })
    })

    it('should clear slot when content is empty', async () => {
      await adapter.update(0, 'test', 'test content')
      await adapter.update(0, '', '')

      const stored = await env.MEMORY_KV.get('memory:0')
      expect(stored).toBeNull()
    })

    it('should reject index out of range', async () => {
      await expect(adapter.update(-1, 'desc', 'content')).rejects.toThrow(
        'out of range',
      )
      await expect(
        adapter.update(ENTRY_LIMIT, 'desc', 'content'),
      ).rejects.toThrow('out of range')
    })

    it('should reject description exceeding limit', async () => {
      const longDesc = 'a'.repeat(DESCRIPTION_LIMIT + 1)
      await expect(adapter.update(0, longDesc, 'content')).rejects.toThrow(
        'Description exceeds',
      )
    })
  })
})
