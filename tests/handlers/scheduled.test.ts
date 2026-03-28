import { env } from 'cloudflare:test'
import { describe, it, expect, vi } from 'vitest'
import { createScheduledHandler } from '../../src/handlers/scheduled'

describe('createScheduledHandler', () => {
  it('should call use case execute with channelId and hours from factory', async () => {
    const execute = vi.fn()
    const handler = createScheduledHandler(() => ({
      usecase: { execute },
      channelId: 'test-channel',
      hours: 12,
    }))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await handler(controller as ScheduledController, env)

    expect(execute).toHaveBeenCalledWith('test-channel', 12)
  })

  it('should pass env to factory', async () => {
    const factory = vi.fn().mockReturnValue({
      usecase: { execute: vi.fn() },
      channelId: '',
      hours: 24,
    })
    const handler = createScheduledHandler(factory)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await handler(controller as ScheduledController, env)

    expect(factory).toHaveBeenCalledWith(env)
  })
})
