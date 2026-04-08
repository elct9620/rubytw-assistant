import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import { scheduledHandler } from '../../src/handlers/scheduled'

const mockSpanEnd = vi.fn()
const mockRecordException = vi.fn()
const mockSetStatus = vi.fn()
const mockSetAttribute = vi.fn()
const mockForceFlush = vi.fn().mockResolvedValue(undefined)

const mockStartActiveSpan = vi.fn()

vi.mock('@aotoki/edge-otel', () => ({
  createTracerProvider: vi.fn(() => ({
    getTracer: () => ({
      startActiveSpan: mockStartActiveSpan,
    }),
    forceFlush: mockForceFlush,
  })),
}))

vi.mock('@aotoki/edge-otel/exporters/langfuse', () => ({
  langfuseExporter: vi.fn(() => ({
    endpoint: 'https://mock/otel/v1/traces',
    headers: {},
  })),
}))

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { OK: 1, ERROR: 2 },
}))

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
  mockSpanEnd.mockClear()
  mockRecordException.mockClear()
  mockSetStatus.mockClear()
  mockSetAttribute.mockClear()
  mockForceFlush.mockClear()
  mockStartActiveSpan.mockReset()
  mockStartActiveSpan.mockImplementation(
    (
      _name: string,
      _opts: unknown,
      fn: (span: unknown) => unknown | Promise<unknown>,
    ) =>
      fn({
        end: mockSpanEnd,
        recordException: mockRecordException,
        setStatus: mockSetStatus,
        setAttribute: mockSetAttribute,
      }),
  )
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

    const result = { topicGroups: [], actionItems: [] }
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

    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })
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
      topicGroups: [{}, {}, {}],
      actionItems: [{}, {}],
    })
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(mockSetAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      JSON.stringify({ topicGroupCount: 3, actionItemCount: 2 }),
    )
  })
})
