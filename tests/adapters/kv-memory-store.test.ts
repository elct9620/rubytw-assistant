import { env } from 'cloudflare:workers'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  KVMemoryStoreAdapter,
  KV_KEY,
} from '../../src/adapters/kv-memory-store'
const ENTRY_LIMIT = 4
const DESCRIPTION_LIMIT = 128

describe('KVMemoryStoreAdapter', () => {
  let adapter: KVMemoryStoreAdapter

  beforeEach(async () => {
    await env.MEMORY_KV.delete(KV_KEY)
    adapter = new KVMemoryStoreAdapter(
      env.MEMORY_KV,
      ENTRY_LIMIT,
      DESCRIPTION_LIMIT,
    )
  })

  describe('list', () => {
    it('should return all slots with empty descriptions when no data exists', async () => {
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
      const stored = [
        { description: '', content: '' },
        { description: 'ongoing tasks', content: 'task details' },
        { description: '', content: '' },
        { description: '', content: '' },
      ]
      await env.MEMORY_KV.put(KV_KEY, JSON.stringify(stored))

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
      const stored = [
        { description: 'ongoing tasks', content: 'task details here' },
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ]
      await env.MEMORY_KV.put(KV_KEY, JSON.stringify(stored))

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

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'test description',
        content: 'test content',
      })
    })

    it('should overwrite existing entry', async () => {
      await adapter.update(0, 'old', 'old content')
      await adapter.update(0, 'new', 'new content')

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'new',
        content: 'new content',
      })
    })

    it('should clear slot when content is empty', async () => {
      await adapter.update(0, 'test', 'test content')
      await adapter.update(0, '', '')

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: '',
        content: '',
      })
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

    it('should throw when data is missing but metadata exists', async () => {
      await env.MEMORY_KV.put(KV_KEY, 'null', {
        metadata: { updatedAt: '2026-04-06T00:00:00Z' },
      })

      await expect(adapter.update(0, 'test', 'content')).rejects.toThrow(
        'Memory data missing but metadata exists',
      )
    })

    it('should store metadata with updatedAt on update', async () => {
      await adapter.update(0, 'test', 'content')

      const { metadata } = await env.MEMORY_KV.getWithMetadata(KV_KEY, 'json')
      expect(metadata).toEqual(
        expect.objectContaining({ updatedAt: expect.any(String) }),
      )
    })

    it('should preserve other slots when updating one', async () => {
      await adapter.update(0, 'slot 0', 'content 0')
      await adapter.update(1, 'slot 1', 'content 1')

      const entries = await adapter.read([0, 1])
      expect(entries).toEqual([
        { index: 0, description: 'slot 0', content: 'content 0' },
        { index: 1, description: 'slot 1', content: 'content 1' },
      ])
    })

    it('should use write-through cache so sequential updates to different slots are not lost', async () => {
      await adapter.update(0, 'first', 'first content')
      await adapter.update(1, 'second', 'second content')
      await adapter.update(2, 'third', 'third content')

      const entries = await adapter.read([0, 1, 2])
      expect(entries).toEqual([
        { index: 0, description: 'first', content: 'first content' },
        { index: 1, description: 'second', content: 'second content' },
        { index: 2, description: 'third', content: 'third content' },
      ])
    })
  })
})
