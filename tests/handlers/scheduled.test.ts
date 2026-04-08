import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import { scheduledHandler } from '../../src/handlers/scheduled'

const telemetry = await vi.hoisted(async () => {
  const { createTelemetryMocks } = await import('../helpers/telemetry-mocks')
  return createTelemetryMocks()
})

vi.mock('@aotoki/edge-otel', () => telemetry.edgeOtelModule)
vi.mock(
  '@aotoki/edge-otel/exporters/langfuse',
  () => telemetry.langfuseExporterModule,
)
vi.mock('@opentelemetry/api', () => telemetry.openTelemetryApiModule)

const {
  mocks: {
    spanEnd: mockSpanEnd,
    recordException: mockRecordException,
    setStatus: mockSetStatus,
    setAttribute: mockSetAttribute,
    forceFlush: mockForceFlush,
    startActiveSpan: mockStartActiveSpan,
  },
} = telemetry

const mockExecute = vi.fn()
const mockPresent = vi.fn()

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
  telemetry.resetAll()
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

  it('should flush OTel trace even when use case throws', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockRejectedValue(new Error('AI service failed'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('AI service failed')

    expect(mockRecordException).toHaveBeenCalled()
    expect(mockSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: 2 }),
    )
    expect(mockSetAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      expect.stringContaining('AI service failed'),
    )
    expect(mockSpanEnd).toHaveBeenCalled()
    expect(mockForceFlush).toHaveBeenCalled()
  })

  it('should re-throw presenter errors after flushing', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })
    mockPresent.mockRejectedValue(new Error('Discord API error'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('Discord API error')

    expect(mockSpanEnd).toHaveBeenCalled()
    expect(mockForceFlush).toHaveBeenCalled()
  })

  it('should flush OTel trace when telemetry is enabled', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    const result = { kind: 'empty' }
    mockExecute.mockResolvedValue(result)
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockSpanEnd).toHaveBeenCalled()
    expect(mockForceFlush).toHaveBeenCalled()
  })

  it('should set langfuse.observation.input on root span when telemetry is enabled', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockResolvedValue({ kind: 'empty' })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      'generate-summary',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'langfuse.observation.input': JSON.stringify({
            cron: '0 16 * * *',
            hours: 12,
          }),
        }),
      }),
      expect.any(Function),
    )
  })

  it('should set langfuse.observation.output with summary stats on success', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockResolvedValue({
      kind: 'success',
      topicGroups: [{}, {}, {}],
      actionItems: [{}, {}],
    })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockSetAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      JSON.stringify({
        kind: 'success',
        topicGroupCount: 3,
        actionItemCount: 2,
      }),
    )
  })
})
