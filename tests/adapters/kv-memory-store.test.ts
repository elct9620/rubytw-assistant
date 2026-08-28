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

    it('should throw when data is missing but metadata exists', async () => {
      await env.MEMORY_KV.put(KV_KEY, 'null', {
        metadata: { updatedAt: '2026-04-06T00:00:00Z' },
      })

      await expect(adapter.list()).rejects.toThrow(
        'Memory data missing but metadata exists',
      )
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

    it('should throw when data is missing but metadata exists', async () => {
      await env.MEMORY_KV.put(KV_KEY, 'null', {
        metadata: { updatedAt: '2026-04-06T00:00:00Z' },
      })

      await expect(adapter.read([0])).rejects.toThrow(
        'Memory data missing but metadata exists',
      )
    })
  })

  describe('update', () => {
    const seed = (slots: { description: string; content: string }[]) =>
      env.MEMORY_KV.put(KV_KEY, JSON.stringify(slots))

    const occupied = (label: string) => ({
      description: label,
      content: `${label} content`,
    })

    it('should store entry at specified index', async () => {
      await adapter.update({ 0: occupied('test') })

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'test',
        content: 'test content',
      })
    })

    it('should store every entry when several slots are given', async () => {
      await adapter.update({ 0: occupied('first'), 2: occupied('third') })

      const entries = await adapter.read([0, 2])
      expect(entries).toEqual([
        { index: 0, description: 'first', content: 'first content' },
        { index: 2, description: 'third', content: 'third content' },
      ])
    })

    it('should write to KV once when several slots are given', async () => {
      let putCount = 0
      const countingKv = {
        getWithMetadata: (key: string, type: 'json') =>
          env.MEMORY_KV.getWithMetadata(key, type),
        put: (key: string, value: string, options?: unknown) => {
          putCount++
          return env.MEMORY_KV.put(key, value, options as KVNamespacePutOptions)
        },
      } as unknown as KVNamespace
      const counting = new KVMemoryStoreAdapter(
        countingKv,
        ENTRY_LIMIT,
        DESCRIPTION_LIMIT,
      )

      await counting.update({
        0: occupied('first'),
        1: occupied('second'),
        2: occupied('third'),
      })

      expect(putCount).toBe(1)
    })

    it('should overwrite existing entry', async () => {
      await seed([
        occupied('old'),
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ])

      await adapter.update({ 0: occupied('new') })

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'new',
        content: 'new content',
      })
    })

    it('should clear slot when content is empty', async () => {
      await seed([
        occupied('existing'),
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ])

      await adapter.update({ 0: { description: 'still here', content: '' } })

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: '',
        content: '',
      })
    })

    it('should reject index out of range', async () => {
      await expect(adapter.update({ [-1]: occupied('a') })).rejects.toThrow(
        'out of range',
      )
      await expect(
        adapter.update({ [ENTRY_LIMIT]: occupied('a') }),
      ).rejects.toThrow('out of range')
    })

    it('should reject description exceeding limit', async () => {
      const longDesc = 'a'.repeat(DESCRIPTION_LIMIT + 1)
      await expect(
        adapter.update({ 0: { description: longDesc, content: 'content' } }),
      ).rejects.toThrow('Description exceeds')
    })

    it('should leave every slot untouched when one index is out of range', async () => {
      await seed([
        occupied('kept'),
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ])

      await expect(
        adapter.update({
          0: occupied('overwritten'),
          [ENTRY_LIMIT]: occupied('rejected'),
        }),
      ).rejects.toThrow('out of range')

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'kept',
        content: 'kept content',
      })
    })

    it('should leave every slot untouched when one description exceeds the limit', async () => {
      await seed([
        occupied('kept'),
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ])

      await expect(
        adapter.update({
          0: occupied('overwritten'),
          1: {
            description: 'a'.repeat(DESCRIPTION_LIMIT + 1),
            content: 'content',
          },
        }),
      ).rejects.toThrow('Description exceeds')

      const entries = await adapter.read([0])
      expect(entries[0]).toEqual({
        index: 0,
        description: 'kept',
        content: 'kept content',
      })
    })

    it('should not write when no entries are given', async () => {
      await adapter.update({})

      const { value } = await env.MEMORY_KV.getWithMetadata(KV_KEY, 'json')
      expect(value).toBeNull()
    })

    it('should throw when data is missing but metadata exists', async () => {
      await env.MEMORY_KV.put(KV_KEY, 'null', {
        metadata: { updatedAt: '2026-04-06T00:00:00Z' },
      })

      await expect(adapter.update({ 0: occupied('test') })).rejects.toThrow(
        'Memory data missing but metadata exists',
      )
    })

    it('should store metadata with updatedAt on update', async () => {
      await adapter.update({ 0: occupied('test') })

      const { metadata } = await env.MEMORY_KV.getWithMetadata(KV_KEY, 'json')
      expect(metadata).toEqual(
        expect.objectContaining({ updatedAt: expect.any(String) }),
      )
    })

    it('should preserve other slots when updating one', async () => {
      await seed([
        occupied('slot 0'),
        { description: '', content: '' },
        { description: '', content: '' },
        { description: '', content: '' },
      ])

      await adapter.update({ 1: occupied('slot 1') })

      const entries = await adapter.read([0, 1])
      expect(entries).toEqual([
        { index: 0, description: 'slot 0', content: 'slot 0 content' },
        { index: 1, description: 'slot 1', content: 'slot 1 content' },
      ])
    })
  })
})
