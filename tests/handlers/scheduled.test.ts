import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import { scheduledHandler } from '../../src/handlers/scheduled'

const mockExecute = vi.fn()

beforeEach(() => {
  container.clearInstances()

  container.register(TOKENS.DiscordChannelId, { useValue: 'test-channel' })
  container.register(TOKENS.SummaryHours, { useValue: 12 })
  container.register(GenerateSummary, {
    useFactory: () => ({ execute: mockExecute }),
  })

  mockExecute.mockReset()
})

describe('scheduledHandler', () => {
  it('should call use case execute with channelId and hours from container', async () => {
    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockExecute).toHaveBeenCalledWith('test-channel', 12)
  })
})
