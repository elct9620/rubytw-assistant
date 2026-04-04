import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import { scheduledHandler } from '../../src/handlers/scheduled'
import { server } from '../msw-server'

const mockExecute = vi.fn()
const mockPresent = vi.fn()

beforeEach(() => {
  container.clearInstances()

  container.register(TOKENS.SummaryHours, { useValue: 12 })
  container.register(TOKENS.SummaryPresenter, {
    useValue: { present: mockPresent },
  })
  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
  container.register(TOKENS.RequestContext, { useFactory: () => ({}) })
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

  it('should flush Langfuse trace even when use case throws', async () => {
    let flushedBatch: unknown[] = []
    server.use(
      http.post(
        'https://us.cloud.langfuse.com/api/public/ingestion',
        async ({ request }) => {
          const body = (await request.json()) as { batch: unknown[] }
          flushedBatch = body.batch
          return HttpResponse.json({ successes: [], errors: [] })
        },
      ),
    )

    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
        environment: 'test',
      }),
    })

    mockExecute.mockRejectedValue(new Error('AI service failed'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('AI service failed')

    expect(flushedBatch.length).toBeGreaterThan(0)
    const traceEvents = flushedBatch.filter(
      (e: Record<string, unknown>) => e.type === 'trace-create',
    ) as Record<string, { output?: unknown; level?: string }>[]
    const errorTrace = traceEvents.find(
      (e) => (e.body as Record<string, unknown>)?.level === 'ERROR',
    )
    expect(errorTrace).toBeDefined()
    expect((errorTrace!.body as Record<string, unknown>).output).toMatchObject({
      error: 'AI service failed',
    })
  })

  it('should re-throw presenter errors after flushing', async () => {
    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })
    mockPresent.mockRejectedValue(new Error('Discord API error'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('Discord API error')
  })

  it('should not mask original error when flush fails', async () => {
    server.use(
      http.post('https://us.cloud.langfuse.com/api/public/ingestion', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
        environment: 'test',
      }),
    })

    mockExecute.mockRejectedValue(new Error('AI service failed'))

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await expect(
      scheduledHandler(controller as ScheduledController),
    ).rejects.toThrow('AI service failed')
  })

  it('should flush Langfuse trace when telemetry is enabled', async () => {
    let flushedBatch: unknown[] = []
    server.use(
      http.post(
        'https://us.cloud.langfuse.com/api/public/ingestion',
        async ({ request }) => {
          const body = (await request.json()) as { batch: unknown[] }
          flushedBatch = body.batch
          return HttpResponse.json({ successes: [], errors: [] })
        },
      ),
    )

    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
        environment: 'test',
      }),
    })

    const result = { topicGroups: [], actionItems: [] }
    mockExecute.mockResolvedValue(result)
    mockPresent.mockResolvedValue(undefined)

    const controller = { cron: '0 16 * * *', scheduledTime: Date.now() }
    await scheduledHandler(controller as ScheduledController)

    expect(flushedBatch.length).toBeGreaterThan(0)
    const traceEvent = flushedBatch.find(
      (e: Record<string, unknown>) => e.type === 'trace-create',
    ) as Record<string, unknown> | undefined
    expect(traceEvent).toBeDefined()
    expect((traceEvent!.body as Record<string, unknown>).name).toBe(
      'generate-summary',
    )
  })
})
