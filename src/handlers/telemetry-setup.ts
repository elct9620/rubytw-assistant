import type { DependencyContainer } from 'tsyringe'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk'
import {
  setLangfuseTracerProvider,
  startActiveObservation,
  type ObservationLevel,
} from '@langfuse/tracing'
import { context } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { TOKENS, type LangfuseConfig } from '../tokens'
import { WorkerContextManager } from './worker-context-manager'

export interface TraceSetup {
  provider: BasicTracerProvider
}

/**
 * OTel resolves span parents through the active context, which needs a
 * context manager to exist at all. Without one `startActiveSpan` cannot
 * nest, so the AI SDK's generation spans would surface as separate traces
 * instead of children of the root span. The global registration is
 * process-wide and survives across invocations in the same isolate, hence
 * the module-scope guard.
 */
let contextManagerRegistered = false

function ensureContextManager(): void {
  if (contextManagerRegistered) return

  context.setGlobalContextManager(new WorkerContextManager())
  contextManagerRegistered = true
}

export function setupTrace(
  child: DependencyContainer,
  options: { scopeName?: string },
): TraceSetup | undefined {
  const config = child.resolve<LangfuseConfig | null>(TOKENS.LangfuseConfig)
  if (!config) {
    // Traces that never leave look the same as traces that were never
    // started, so say which one this is.
    console.warn(
      'telemetry disabled: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required',
    )
    return undefined
  }

  ensureContextManager()

  const provider = new BasicTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        environment: config.environment,
        // `immediate` issues one HTTP request per span, which a tool-using
        // summary run would multiply into hundreds of subrequests. Batching
        // is safe here because every invocation force-flushes before it ends.
        exportMode: 'batched',
        // Media upload issues extra API calls for base64 payloads; this
        // pipeline only ever produces text.
        mediaUploadEnabled: false,
        // This provider exists solely to feed Langfuse, so every span it
        // produces is meant to be exported. The default filter keys off the
        // instrumentation scope name, which would silently drop spans if the
        // scope were ever renamed.
        shouldExportSpan: () => true,
      }),
    ],
  })

  const tracer = provider.getTracer(options.scopeName ?? 'ai')
  child.register(TOKENS.Telemetry, {
    useValue: new LangfuseVercelAiSdkIntegration({ tracer }),
  })

  // `startActiveObservation` reads the provider from this module-level slot
  // rather than from an argument, so the per-invocation provider has to be
  // handed over before any observation starts.
  setLangfuseTracerProvider(provider)

  return { provider }
}

/**
 * Classification a handler can return to mark a successful-but-degraded
 * result on the root observation.
 */
export interface ResultClassification {
  level: ObservationLevel
  statusMessage: string
}

export interface RunWithTraceOptions<T> {
  spanName: string
  input: unknown
  summarizeOutput: (result: T) => unknown
  /**
   * Inspect the resolved result and optionally flag it as degraded. Called
   * only on the success path — exceptions are recorded by Langfuse itself.
   */
  classifyResult?: (result: T) => ResultClassification | undefined
  fn: () => Promise<T>
}

/**
 * Execute `fn` as the root Langfuse observation when telemetry is active,
 * otherwise just run it directly. Recording exceptions and ending the
 * observation belong to `startActiveObservation`; what is left here is the
 * flush every Worker invocation owes before it terminates.
 */
export async function runWithTrace<T>(
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

  try {
    return await startActiveObservation(spanName, async (span) => {
      span.update({ input })
      const result = await fn()
      span.update({
        output: summarizeOutput(result),
        ...classifyResult?.(result),
      })
      return result
    })
  } finally {
    // A rejected flush inside `finally` would replace whatever error the
    // handler was already throwing, so telemetry trouble must never escape —
    // but it does have to be visible, since OTel discards exporter failures
    // through a no-op `diag` logger by default.
    try {
      await trace.provider.forceFlush()
    } catch (error) {
      console.warn('telemetry flush failed:', error)
    }
  }
}
