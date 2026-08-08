import { container } from 'tsyringe'
import { describe, it, expect, beforeEach } from 'vitest'
import type { Tracer } from '@opentelemetry/api'
import { TOKENS } from '../../src/tokens'
import { runWithTrace, setupTrace } from '../../src/handlers/telemetry-setup'
import {
  captureLangfuseSpans,
  LANGFUSE_TEST_CONFIG,
} from '../helpers/langfuse-otlp'

beforeEach(() => {
  container.clearInstances()
})

describe('setupTrace', () => {
  it('should stay inactive when Langfuse is not configured', () => {
    const child = container.createChildContainer()
    child.register(TOKENS.LangfuseConfig, { useFactory: () => null })

    expect(setupTrace(child, {})).toBeUndefined()
  })

  it('should nest spans started inside the root span', async () => {
    const langfuse = captureLangfuseSpans()
    const child = container.createChildContainer()
    child.register(TOKENS.LangfuseConfig, {
      useFactory: () => LANGFUSE_TEST_CONFIG,
    })

    const trace = setupTrace(child, {})
    await runWithTrace(child, trace, {
      spanName: 'root',
      input: {},
      summarizeOutput: () => ({}),
      fn: async () => {
        // Stands in for the AI SDK, which starts its generation spans from
        // the active context rather than from an explicit parent.
        const tracer = child.resolve<Tracer>(TOKENS.Tracer)
        tracer.startSpan('generation').end()
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

    const trace = setupTrace(child, {})
    await runWithTrace(child, trace, {
      spanName: 'root',
      input: {},
      summarizeOutput: () => ({}),
      fn: async () => {
        const tracer = child.resolve<Tracer>(TOKENS.Tracer)
        for (let step = 0; step < 10; step += 1) {
          tracer.startSpan(`step-${step}`).end()
        }
      },
    })

    // A tool-using summary run produces spans by the hundred. Exporting each
    // one on its own would spend the Worker's subrequest budget on telemetry.
    expect(langfuse.spans()).toHaveLength(11)
    expect(langfuse.requestCount()).toBe(1)
  })
})
