import { http, HttpResponse } from 'msw'
import { network } from '../msw-server'

export const LANGFUSE_BASE_URL = 'https://us.cloud.langfuse.com'
export const LANGFUSE_OTLP_ENDPOINT = `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`

export const LANGFUSE_TEST_CONFIG = {
  publicKey: 'pk-test',
  secretKey: 'sk-test',
  baseUrl: LANGFUSE_BASE_URL,
}

export interface CapturedSpan {
  name: string
  spanId: string
  parentSpanId?: string
  attributes: Record<string, unknown>
  status: { code?: number; message?: string }
}

interface OtlpAnyValue {
  stringValue?: string
  boolValue?: boolean
  intValue?: string | number
  doubleValue?: number
  arrayValue?: { values: OtlpAnyValue[] }
}

interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

interface OtlpSpan {
  name: string
  spanId: string
  parentSpanId?: string
  attributes?: OtlpKeyValue[]
  status?: { code?: number; message?: string }
}

interface OtlpPayload {
  resourceSpans?: { scopeSpans?: { spans?: OtlpSpan[] }[] }[]
}

function readAnyValue(value: OtlpAnyValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue
  if (value.boolValue !== undefined) return value.boolValue
  if (value.intValue !== undefined) return Number(value.intValue)
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.arrayValue !== undefined)
    return value.arrayValue.values.map(readAnyValue)
  return undefined
}

function readAttributes(
  attributes: OtlpKeyValue[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    attributes.map(({ key, value }) => [key, readAnyValue(value)]),
  )
}

/**
 * Intercept the Langfuse OTLP endpoint and expose the spans that actually
 * left the Worker. Asserting on exported payloads rather than on mocked
 * tracer calls keeps the tests honest about what Langfuse will receive.
 */
export function captureLangfuseSpans(): {
  spans: () => CapturedSpan[]
  find: (name: string) => CapturedSpan | undefined
  requestCount: () => number
} {
  const captured: CapturedSpan[] = []
  let requests = 0

  network.use(
    http.post(LANGFUSE_OTLP_ENDPOINT, async ({ request }) => {
      requests += 1
      const payload = (await request.json()) as OtlpPayload

      for (const resourceSpan of payload.resourceSpans ?? []) {
        for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
          for (const span of scopeSpan.spans ?? []) {
            captured.push({
              name: span.name,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              attributes: readAttributes(span.attributes),
              status: span.status ?? {},
            })
          }
        }
      }

      return HttpResponse.json({ partialSuccess: {} })
    }),
  )

  return {
    spans: () => captured,
    find: (name) => captured.find((span) => span.name === name),
    requestCount: () => requests,
  }
}
