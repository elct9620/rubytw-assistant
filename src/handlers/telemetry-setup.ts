import type { DependencyContainer } from 'tsyringe'
import type { TracerProvider } from '@aotoki/edge-otel'
import { createTracerProvider } from '@aotoki/edge-otel'
import { langfuseExporter } from '@aotoki/edge-otel/exporters/langfuse'
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
