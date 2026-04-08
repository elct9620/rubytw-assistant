import { vi } from 'vitest'

export interface TelemetryMocks {
  spanEnd: ReturnType<typeof vi.fn>
  recordException: ReturnType<typeof vi.fn>
  setStatus: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  forceFlush: ReturnType<typeof vi.fn>
  startActiveSpan: ReturnType<typeof vi.fn>
}

export interface TelemetryTestHarness {
  mocks: TelemetryMocks
  edgeOtelModule: {
    createTracerProvider: ReturnType<typeof vi.fn>
  }
  langfuseExporterModule: {
    langfuseExporter: ReturnType<typeof vi.fn>
  }
  openTelemetryApiModule: {
    SpanStatusCode: { OK: number; ERROR: number }
  }
  resetAll: () => void
}

/**
 * Shared OTel telemetry mock harness for handler tests. Must be invoked
 * inside `vi.hoisted(...)` so that the returned modules are available
 * when the top-level `vi.mock(...)` factories run. Because `vi.hoisted`
 * runs before imports are resolved, the factory uses a dynamic `import()`
 * to pull this helper in.
 *
 * Usage:
 *
 *   const telemetry = await vi.hoisted(async () => {
 *     const { createTelemetryMocks } = await import(
 *       '../helpers/telemetry-mocks'
 *     )
 *     return createTelemetryMocks()
 *   })
 *
 *   vi.mock('@aotoki/edge-otel', () => telemetry.edgeOtelModule)
 *   vi.mock(
 *     '@aotoki/edge-otel/exporters/langfuse',
 *     () => telemetry.langfuseExporterModule,
 *   )
 *   vi.mock('@opentelemetry/api', () => telemetry.openTelemetryApiModule)
 *
 * See tests/handlers/scheduled.test.ts and tests/handlers/debug.test.ts
 * for the complete wiring.
 */
export function createTelemetryMocks(): TelemetryTestHarness {
  const spanEnd = vi.fn()
  const recordException = vi.fn()
  const setStatus = vi.fn()
  const setAttribute = vi.fn()
  const forceFlush = vi.fn().mockResolvedValue(undefined)
  const startActiveSpan = vi.fn()

  const installDefaultSpanImplementation = () => {
    startActiveSpan.mockImplementation(
      (
        _name: string,
        _opts: unknown,
        fn: (span: unknown) => unknown | Promise<unknown>,
      ) =>
        fn({
          end: spanEnd,
          recordException,
          setStatus,
          setAttribute,
        }),
    )
  }

  installDefaultSpanImplementation()

  return {
    mocks: {
      spanEnd,
      recordException,
      setStatus,
      setAttribute,
      forceFlush,
      startActiveSpan,
    },
    edgeOtelModule: {
      createTracerProvider: vi.fn(() => ({
        getTracer: () => ({ startActiveSpan }),
        forceFlush,
      })),
    },
    langfuseExporterModule: {
      langfuseExporter: vi.fn(() => ({
        endpoint: 'https://mock/otel/v1/traces',
        headers: {},
      })),
    },
    openTelemetryApiModule: {
      SpanStatusCode: { OK: 1, ERROR: 2 },
    },
    resetAll: () => {
      spanEnd.mockClear()
      recordException.mockClear()
      setStatus.mockClear()
      setAttribute.mockClear()
      forceFlush.mockClear()
      startActiveSpan.mockReset()
      installDefaultSpanImplementation()
    },
  }
}
