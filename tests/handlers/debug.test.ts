import { container } from 'tsyringe'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { GenerateSummary } from '../../src/usecases/generate-summary'
import debug from '../../src/handlers/debug'
import {
  captureLangfuseSpans,
  LANGFUSE_TEST_CONFIG,
} from '../helpers/langfuse-otlp'

const mockExecute = vi.fn()

const enableTelemetry = () =>
  container.register(TOKENS.LangfuseConfig, {
    useFactory: () => LANGFUSE_TEST_CONFIG,
  })

beforeEach(() => {
  container.register(TOKENS.FollowUpAgent, { useValue: {} })
  container.register(TOKENS.DiscordSource, { useValue: {} })
  container.register(TOKENS.LangfuseConfig, { useFactory: () => null })
  container.register(GenerateSummary, {
    useFactory: () => ({ execute: mockExecute }),
  })

  mockExecute.mockReset()
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
    mockExecute.mockResolvedValue({ kind: 'success', items: [] })

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

  it('should return the follow-up list as JSON', async () => {
    const result = {
      kind: 'success',
      items: [
        {
          status: 'stalled',
          description: 'Do thing',
          assignee: 'Bob',
          lastProgress: '2026-10-05',
          reason: 'Needed',
        },
      ],
    }
    mockExecute.mockResolvedValue(result)

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(result)
    expect(mockExecute).toHaveBeenCalled()
  })

  it('should use custom hours when provided', async () => {
    mockExecute.mockResolvedValue({ kind: 'success', items: [] })

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

  it('should answer with an error naming the Follow-up Agent when it fails', async () => {
    mockExecute.mockResolvedValue({
      kind: 'fallback',
      rawMessages: ['msg-1'],
      reason: '[Follow-up Agent] token budget exceeded',
    })

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: '[Follow-up Agent] token budget exceeded',
    })
  })

  it('should export the root span when telemetry is enabled', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({ kind: 'success', items: [] })

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(200)
    expect(langfuse.find('generate-summary')).toBeDefined()
  })

  it('should set langfuse.observation.input on root span when telemetry is enabled', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockResolvedValue({ kind: 'success', items: [] })

    await debug.request('/summary?channel_id=ch-1&hours=12', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(
      langfuse.find('generate-summary')?.attributes[
        'langfuse.observation.input'
      ],
    ).toBe(JSON.stringify({ channelId: 'ch-1', hours: 12, debug: true }))
  })

  it('should set langfuse.observation.output with error info on failure', async () => {
    enableTelemetry()
    const langfuse = captureLangfuseSpans()

    mockExecute.mockRejectedValue(new Error('Discord API failed'))

    const res = await debug.request('/summary?channel_id=ch-1', undefined, {
      SUMMARY_HOURS: '24',
    })

    expect(res.status).toBe(500)
    const span = langfuse.find('generate-summary')
    expect(span?.status.code).toBe(2)
    expect(span?.status.message).toBe('Discord API failed')
  })
})
