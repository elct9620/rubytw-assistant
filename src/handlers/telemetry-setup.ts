import type { DependencyContainer } from 'tsyringe'
import type { TracerProvider } from '@aotoki/edge-otel'
import { createTracerProvider } from '@aotoki/edge-otel'
import { langfuseExporter } from '@aotoki/edge-otel/exporters/langfuse'
import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
import { TOKENS, type LangfuseConfig } from '../tokens'

export interface TraceSetup {
  provider: TracerProvider
}

export function setupTrace(
  child: DependencyContainer,
  options: { scopeName?: string },
): TraceSetup | undefined {
  const config = child.resolve<LangfuseConfig | null>(TOKENS.LangfuseConfig)
  if (!config) return undefined

  const provider = createTracerProvider({
    ...langfuseExporter({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
      environment: config.environment,
    }),
  })

  const tracer = provider.getTracer(options.scopeName ?? 'ai')
  child.register(TOKENS.Tracer, { useValue: tracer })

  return { provider }
}

/**
 * Classification a handler can return to mark a successful-but-degraded
 * result on the root span. WARNING becomes a Langfuse WARNING observation
 * (span status stays OK); ERROR additionally sets OTel span status ERROR.
 */
export interface ResultClassification {
  level: 'WARNING' | 'ERROR'
  message: string
}

export interface RunWithTraceOptions<T> {
  spanName: string
  input: unknown
  summarizeOutput: (result: T) => unknown
  /**
   * Inspect the resolved result and optionally flag it as degraded. Called
   * only on the success path — exceptions are still recorded as ERROR.
   */
  classifyResult?: (result: T) => ResultClassification | undefined
  fn: () => Promise<T>
}

/**
 * Execute `fn` inside a root OTel span when telemetry is active, otherwise
 * just run it directly. Sets `langfuse.observation.input`/`output` attributes
 * on the root span so Langfuse v4 Fast UI can render them, records exceptions,
 * and flushes the provider in `finally`.
 */
export async function runWithTrace<T>(
  child: DependencyContainer,
  trace: TraceSetup | undefined,
  {
    spanName,
    input,
    summarizeOutput,
    classifyResult,
    fn,
  }: RunWithTraceOptions<T>,
): Promise<T> {
  if (!trace) {
    return fn()
  }

  const tracer = child.resolve<Tracer>(TOKENS.Tracer)
  return tracer.startActiveSpan(
    spanName,
    {
      attributes: {
        'langfuse.observation.input': JSON.stringify(input),
      },
    },
    async (span) => {
      try {
        const result = await fn()
        span.setAttribute(
          'langfuse.observation.output',
          JSON.stringify(summarizeOutput(result)),
        )
        const classification = classifyResult?.(result)
        if (classification) {
          span.setAttribute('langfuse.observation.level', classification.level)
          span.setAttribute(
            'langfuse.observation.status_message',
            classification.message,
          )
          if (classification.level === 'ERROR') {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: classification.message,
            })
          }
        }
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.setAttribute(
          'langfuse.observation.output',
          JSON.stringify({ error: err.message, stack: err.stack }),
        )
        throw error
      } finally {
        span.end()
        await trace.provider.forceFlush()
      }
    },
  )
}
