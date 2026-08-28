import { container } from 'tsyringe'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { TOKENS } from '../../src/tokens'
import { startObservation } from '@langfuse/tracing'
import { runWithTrace, setupTrace } from '../../src/handlers/telemetry-setup'
import { server } from '../msw-server'
import {
  captureLangfuseSpans,
  LANGFUSE_OTLP_ENDPOINT,
  LANGFUSE_TEST_CONFIG,
} from '../helpers/langfuse-otlp'

beforeEach(() => {})

describe('setupTrace', () => {
  it('should stay inactive when Langfuse is not configured', () => {
    const warnings: unknown[][] = []
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args)
    })
    const child = container.createChildContainer()
    child.register(TOKENS.LangfuseConfig, { useFactory: () => null })

    expect(setupTrace(child)).toBeUndefined()
    // Silently skipping telemetry is indistinguishable from telemetry that
    // ran and reported nothing, which is the harder failure to diagnose.
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('should nest spans started inside the root span', async () => {
    const langfuse = captureLangfuseSpans()
    const child = container.createChildContainer()
    child.register(TOKENS.LangfuseConfig, {
      useFactory: () => LANGFUSE_TEST_CONFIG,
    })

    const trace = setupTrace(child)
    await runWithTrace(trace, {
      spanName: 'root',
      input: {},
      summarizeOutput: () => ({}),
      fn: async () => {
        // Stands in for the AI SDK, which starts its generation spans from
        // the active context rather than from an explicit parent.
        startObservation('generation').end()
      },
    })

    const root = langfuse.find('root')
    const generation = langfuse.find('generation')
    expect(root).toBeDefined()
    expect(generation?.parentSpanId).toBe(root?.spanId)
  })

  it('should export a whole invocation in a single request', async () => {
    const langfuse = captureLangfuseSpans()
    const child = container.createChildContainer()
    child.register(TOKENS.LangfuseConfig, {
      useFactory: () => LANGFUSE_TEST_CONFIG,
    })

    const trace = setupTrace(child)
    await runWithTrace(trace, {
      spanName: 'root',
      input: {},
      summarizeOutput: () => ({}),
      fn: async () => {
        for (let step = 0; step < 10; step += 1) {
          startObservation(`step-${step}`).end()
        }
      },
    })

    // A tool-using summary run produces spans by the hundred. Exporting each
    // one on its own would spend the Worker's subrequest budget on telemetry.
    expect(langfuse.spans()).toHaveLength(11)
    expect(langfuse.requestCount()).toBe(1)
  })

  describe('when Langfuse rejects the export', () => {
    const rejectExports = () =>
      server.use(
        http.post(
          LANGFUSE_OTLP_ENDPOINT,
          () => new HttpResponse(null, { status: 401 }),
        ),
      )

    const spyOnWarn = () => {
      const warnings: unknown[][] = []
      vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args)
      })
      return warnings
    }

    const traced = () => {
      const child = container.createChildContainer()
      child.register(TOKENS.LangfuseConfig, {
        useFactory: () => LANGFUSE_TEST_CONFIG,
      })
      return { child, trace: setupTrace(child) }
    }

    it('should report the failure', async () => {
      rejectExports()
      const warnings = spyOnWarn()
      const { trace } = traced()

      await runWithTrace(trace, {
        spanName: 'root',
        input: {},
        summarizeOutput: () => ({}),
        fn: async () => {},
      })

      // OTel routes exporter failures through `diag`, whose default logger
      // discards everything — a Worker that cannot reach Langfuse would
      // otherwise look exactly like one that never tried.
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('should not swallow the error the handler was already throwing', async () => {
      rejectExports()
      spyOnWarn()
      const { trace } = traced()

      await expect(
        runWithTrace(trace, {
          spanName: 'root',
          input: {},
          summarizeOutput: () => ({}),
          fn: async () => {
            throw new Error('AI service failed')
          },
        }),
      ).rejects.toThrow('AI service failed')
    })
  })
})
