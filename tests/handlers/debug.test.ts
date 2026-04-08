import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import debug from '../../src/handlers/debug'

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
    setAttribute: mockSetAttribute,
    forceFlush: mockForceFlush,
    startActiveSpan: mockStartActiveSpan,
  },
} = telemetry

const mockExecute = vi.fn()

beforeEach(() => {
  container.clearInstances()

  container.register(TOKENS.ConversationGrouper, { useValue: {} })
  container.register(TOKENS.ActionItemGenerator, { useValue: {} })
  container.register(TOKENS.DiscordSource, { useValue: {} })
  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
  container.register(GenerateSummary, {
    useFactory: () => ({ execute: mockExecute }),
  })

  mockExecute.mockReset()
  telemetry.resetAll()
})

describe('debug handler', () => {
  it('should return 404 when request does not originate from localhost', async () => {
    const res = await debug.request(
      'https://rubytw-assistant.example.workers.dev/summary?channel_id=ch-1',
      undefined,
      { SUMMARY_HOURS: '24' },
    )

    expect(res.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('should accept requests on 127.0.0.1', async () => {
    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })

    const res = await debug.request(
      'http://127.0.0.1:8787/summary?channel_id=ch-1',
      undefined,
      { SUMMARY_HOURS: '24' },
    )

    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalled()
  })

  it('should return 400 when channel_id is missing', async () => {
    const res = await debug.request('/summary')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('should return topic groups and action items as JSON', async () => {
    const topicGroups = [
      {
        topic: 'Test',
        summary: 'Test summary',
        communityRelated: 'yes',
        smallTalk: 'no',
        lostContext: 'no',
      },
    ]
    const actionItems = [
      {
        status: 'to-do',
        description: 'Do thing',
        assignee: 'Bob',
        reason: 'Needed',
      },
    ]
    mockExecute.mockResolvedValue({ topicGroups, actionItems })

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ topicGroups, actionItems })
    expect(mockExecute).toHaveBeenCalled()
  })

  it('should use custom hours when provided', async () => {
    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })

    await debug.request('/summary?channel_id=ch-1&hours=12', {
      SUMMARY_HOURS: '24',
    })

    expect(mockExecute).toHaveBeenCalledWith(12)
  })

  it('should return error JSON when use case throws', async () => {
    mockExecute.mockRejectedValue(new Error('Discord API failed'))

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Discord API failed' })
  })

  it('should flush OTel trace when telemetry is enabled', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockResolvedValue({ topicGroups: [], actionItems: [] })

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(200)
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

    await debug.request('/summary?channel_id=ch-1&hours=12', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      'generate-summary',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'langfuse.observation.input': JSON.stringify({
            channelId: 'ch-1',
            hours: 12,
            debug: true,
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
      topicGroups: [{}, {}],
      actionItems: [{}],
    })

    await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(mockSetAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      JSON.stringify({
        kind: 'success',
        topicGroupCount: 2,
        actionItemCount: 1,
      }),
    )
  })

  it('should set langfuse.observation.output with error info on failure', async () => {
    container.register(TOKENS.LangfuseConfig, {
      useFactory: () => ({
        publicKey: 'pk-test',
        secretKey: 'sk-test',
        baseUrl: 'https://us.cloud.langfuse.com',
      }),
    })

    mockExecute.mockRejectedValue(new Error('Discord API failed'))

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(500)
    expect(mockSetAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      expect.stringContaining('Discord API failed'),
    )
    expect(mockRecordException).toHaveBeenCalled()
    expect(mockSpanEnd).toHaveBeenCalled()
    expect(mockForceFlush).toHaveBeenCalled()
  })
})
