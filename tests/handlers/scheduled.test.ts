import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import { scheduledHandler } from '../../src/handlers/scheduled'
import {
  captureLangfuseSpans,
  LANGFUSE_TEST_CONFIG,
} from '../helpers/langfuse-otlp'

const mockExecute = vi.fn()
const mockPresent = vi.fn()

const enableTelemetry = () =>
  container.register(TOKENS.LangfuseConfig, {
    useFactory: () => LANGFUSE_TEST_CONFIG,
  })

beforeEach(() => {
  container.clearInstances()

  container.register(TOKENS.SummaryHours, { useValue: 12 })
  container.register(TOKENS.SummaryPresenter, {
    useValue: { present: mockPresent },
  })
  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
  container.register(GenerateSummary, {
    useFactory: () => ({ execute: mockExecute }),
  })

  mockExecute.mockReset()
  mockPresent.mockReset()
})

describe('scheduledHandler', () => {
  it('should call use case execute and pass result to presenter', async () => {
    const result = { topicGroups: [], actionItems: [] }
    mockExecute.mockResolvedValue(result)
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockExecute).toHaveBeenCalledWith(12)
    expect(mockPresent).toHaveBeenCalledWith(result)
  })

  it('should export the root span even when use case throws', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockRejectedValue(new Error('AI service failed'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('AI service failed')

    const span = langfuse.find('generate-summary')
    expect(span?.status.code).toBe(2)
    expect(span?.status.message).toBe('AI service failed')
  })

  it('should export the root span after re-throwing presenter errors', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })
    mockPresent.mockRejectedValue(new Error('Discord API error'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('Discord API error')

    expect(langfuse.find('generate-summary')?.status.code).toBe(2)
  })

  it('should not export anything when telemetry is disabled', async () => {
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({ kind: 'empty' })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(langfuse.requestCount()).toBe(0)
  })

  it('should set langfuse.observation.input on the root span', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({ kind: 'empty' })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(
      langfuse.find('generate-summary')?.attributes[
        'langfuse.observation.input'
      ],
    ).toBe(JSON.stringify({ cron: '0 16 * * *', hours: 12 }))
  })

  it('should flag fallback results as WARNING on the root span', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({
      kind: 'fallback',
      rawMessages: ['msg-1'],
      reason: 'AI service down',
    })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    const span = langfuse.find('generate-summary')
    expect(span?.attributes['langfuse.observation.level']).toBe('WARNING')
    expect(span?.attributes['langfuse.observation.status_message']).toBe(
      'AI service down',
    )
    // span status stays OK for WARNING — only ERROR-level classifications
    // mark the span itself as failed
    expect(span?.status.code).not.toBe(2)
  })

  it('should set langfuse.observation.output with summary stats on success', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({
      kind: 'success',
      topicGroups: [{}, {}, {}],
      actionItems: [{}, {}],
    })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(
      langfuse.find('generate-summary')?.attributes[
        'langfuse.observation.output'
      ],
    ).toBe(
      JSON.stringify({
        kind: 'success',
        topicGroupCount: 3,
        actionItemCount: 2,
      }),
    )
  })
})
