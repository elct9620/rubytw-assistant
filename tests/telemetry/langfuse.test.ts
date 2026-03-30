import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LangfuseClient } from '../../src/telemetry/client'
import { LangfuseTracer } from '../../src/telemetry/tracer'
import { LangfuseTelemetryIntegration } from '../../src/telemetry/integration'

describe('LangfuseClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
  })

  it('sends batched events via POST', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1', name: 'test' },
    })

    await client.flush()

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://cloud.langfuse.com/api/public/ingestion')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.batch).toHaveLength(1)
    expect(body.batch[0].type).toBe('trace-create')
  })

  it('sends correct auth header', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()

    const [, options] = fetchSpy.mock.calls[0]
    const expectedAuth = `Basic ${btoa('pk-test:sk-test')}`
    expect(options.headers['Authorization']).toBe(expectedAuth)
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('uses custom base URL', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: 'https://custom.langfuse.com',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://custom.langfuse.com/api/public/ingestion')
  })

  it('skips send when no events', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    await client.flush()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('clears buffer after flush', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()
    expect(fetchSpy).toHaveBeenCalledOnce()

    await client.flush()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('clears buffer even on HTTP error response', async () => {
    fetchSpy.mockResolvedValue(new Response('error', { status: 500 }))

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()
    expect(fetchSpy).toHaveBeenCalledOnce()

    await client.flush()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('createScore emits score-create with id in body', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.createScore('trace-123', 'user-feedback', 1)

    await client.flush()

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    const event = body.batch[0]
    expect(event.type).toBe('score-create')
    expect(event.body.id).toBeDefined()
    expect(typeof event.body.id).toBe('string')
    expect(event.body.traceId).toBe('trace-123')
    expect(event.body.name).toBe('user-feedback')
    expect(event.body.value).toBe(1)
  })

  it('warns on HTTP error response', async () => {
    fetchSpy.mockResolvedValue(new Response('error', { status: 400 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()

    expect(warnSpy).toHaveBeenCalledWith('Langfuse flush failed: HTTP 400')
    warnSpy.mockRestore()
  })

  it('warns on fetch failure instead of throwing', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })

    client.emit({
      id: 'e1',
      type: 'trace-create',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: { id: 't1' },
    })

    await client.flush()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('LangfuseTracer', () => {
  let client: LangfuseClient
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    let uuidCounter = 0
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
    })

    client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })
  })

  function parseBatch(): Record<string, unknown>[] {
    return JSON.parse(fetchSpy.mock.calls[0][1].body).batch
  }

  it('createTrace sets traceId and emits trace-create', async () => {
    const tracer = new LangfuseTracer({ client })
    const traceId = tracer.createTrace({
      name: 'test-trace',
      input: { question: 'test' },
    })

    expect(traceId).toBe('uuid-1')
    expect(tracer.traceId).toBe('uuid-1')

    await tracer.flush()
    const batch = parseBatch()
    expect(batch).toHaveLength(1)
    expect(batch[0].type).toBe('trace-create')
    expect((batch[0].body as Record<string, unknown>).name).toBe('test-trace')
  })

  it('includes environment in trace-create', async () => {
    const tracer = new LangfuseTracer({
      client,
      environment: 'production',
    })

    tracer.createTrace({ name: 'test', input: 'test' })
    await tracer.flush()

    const batch = parseBatch()
    expect((batch[0].body as Record<string, unknown>).environment).toBe(
      'production',
    )
  })

  it('omits environment when not provided', async () => {
    const tracer = new LangfuseTracer({ client })
    tracer.createTrace({ name: 'test', input: 'test' })
    await tracer.flush()

    const batch = parseBatch()
    expect(
      (batch[0].body as Record<string, unknown>).environment,
    ).toBeUndefined()
  })

  it('createAgent and endAgent use agent-create and agent-update', async () => {
    const tracer = new LangfuseTracer({ client })
    tracer.createTrace({ name: 'test', input: 'test' })
    const agentId = tracer.createAgent({ name: 'test-agent' })
    tracer.endAgent(agentId, 'final response')

    await tracer.flush()
    const batch = parseBatch()

    const agentCreate = batch.find((e) => e.type === 'agent-create') as Record<
      string,
      unknown
    >
    const agentUpdate = batch.find((e) => e.type === 'agent-update') as Record<
      string,
      unknown
    >

    expect(agentCreate).toBeDefined()
    expect((agentCreate.body as Record<string, unknown>).name).toBe(
      'test-agent',
    )
    expect((agentCreate.body as Record<string, unknown>).traceId).toBe('uuid-1')

    expect(agentUpdate).toBeDefined()
    expect((agentUpdate.body as Record<string, unknown>).id).toBe(agentId)
    expect((agentUpdate.body as Record<string, unknown>).output).toBe(
      'final response',
    )
  })

  it('createGeneration and endGeneration work correctly', async () => {
    const tracer = new LangfuseTracer({ client })
    tracer.createTrace({ name: 'test', input: 'test' })
    const agentId = tracer.createAgent({ name: 'test-agent' })

    const genId = tracer.createGeneration({
      parentId: agentId,
      name: 'step-0',
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'Hello' }],
    })

    tracer.endGeneration(genId, {
      output: { text: 'response' },
      model: 'openai/gpt-4.1-mini',
      usage: { input: 50, output: 25, total: 75 },
    })

    await tracer.flush()
    const batch = parseBatch()

    const genCreate = batch.find(
      (e) => e.type === 'generation-create',
    ) as Record<string, unknown>
    expect(
      (genCreate.body as Record<string, unknown>).parentObservationId,
    ).toBe(agentId)
    expect((genCreate.body as Record<string, unknown>).model).toBe(
      'openai/gpt-4.1-mini',
    )

    const genUpdate = batch.find(
      (e) => e.type === 'generation-update',
    ) as Record<string, unknown>
    expect((genUpdate.body as Record<string, unknown>).model).toBe(
      'openai/gpt-4.1-mini',
    )
    expect((genUpdate.body as Record<string, unknown>).usage).toEqual({
      input: 50,
      output: 25,
      total: 75,
      unit: 'TOKENS',
    })
  })

  it('createTool emits tool-create with parent', async () => {
    const tracer = new LangfuseTracer({ client })
    tracer.createTrace({ name: 'test', input: 'test' })

    tracer.createTool({
      parentId: 'gen-1',
      name: 'memory_read',
      input: { query: 'test' },
      output: [{ key: 'test' }],
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-01-01T00:00:01.000Z',
      metadata: { durationMs: 100, success: true },
    })

    await tracer.flush()
    const batch = parseBatch()
    const toolEvent = batch.find((e) => e.type === 'tool-create') as Record<
      string,
      unknown
    >

    expect((toolEvent.body as Record<string, unknown>).name).toBe('memory_read')
    expect(
      (toolEvent.body as Record<string, unknown>).parentObservationId,
    ).toBe('gen-1')
    expect((toolEvent.body as Record<string, unknown>).input).toEqual({
      query: 'test',
    })
    expect((toolEvent.body as Record<string, unknown>).output).toEqual([
      { key: 'test' },
    ])
  })

  it('setTraceId allows using existing trace', async () => {
    const tracer = new LangfuseTracer({ client })
    tracer.setTraceId('existing-trace-id')

    tracer.createAgent({ name: 'test-agent' })
    await tracer.flush()

    const batch = parseBatch()
    const agentCreate = batch.find((e) => e.type === 'agent-create') as Record<
      string,
      unknown
    >
    expect((agentCreate.body as Record<string, unknown>).traceId).toBe(
      'existing-trace-id',
    )
  })
})

describe('LangfuseTelemetryIntegration', () => {
  let client: LangfuseClient
  let tracer: LangfuseTracer
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    let uuidCounter = 0
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
    })

    client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    })
    tracer = new LangfuseTracer({ client })
    tracer.createTrace({ name: 'test', input: 'test' })
  })

  async function runLifecycle(
    inst: LangfuseTelemetryIntegration,
    overrides: {
      stepFinish?: Record<string, unknown>
      finish?: Record<string, unknown>
      withToolCall?: boolean
    } = {},
  ) {
    await inst.onStart!({
      model: { provider: 'openai', modelId: 'openai/gpt-4.1-mini' },
      prompt: 'test',
    } as Parameters<NonNullable<typeof inst.onStart>>[0])

    await inst.onStepStart!({
      stepNumber: 0,
      model: { provider: 'openai', modelId: 'openai/gpt-4.1-mini' },
      ...(overrides.stepFinish?.system !== undefined && {
        system: overrides.stepFinish.system,
      }),
      ...(overrides.stepFinish?.messages !== undefined && {
        messages: overrides.stepFinish.messages,
      }),
    } as Parameters<NonNullable<typeof inst.onStepStart>>[0])

    if (overrides.withToolCall) {
      await inst.onToolCallStart!({
        stepNumber: 0,
        toolCall: {
          toolCallId: 'tc-1',
          toolName: 'memory_read',
          input: { query: 'test' },
        },
      } as Parameters<NonNullable<typeof inst.onToolCallStart>>[0])

      await inst.onToolCallFinish!({
        stepNumber: 0,
        toolCall: {
          toolCallId: 'tc-1',
          toolName: 'memory_read',
          input: { query: 'test' },
        },
        success: true,
        output: [{ key: 'test' }],
        durationMs: 100,
      } as Parameters<NonNullable<typeof inst.onToolCallFinish>>[0])
    }

    await inst.onStepFinish!({
      stepNumber: 0,
      usage: { inputTokens: 50, outputTokens: 25 },
      text: 'response',
      response: { modelId: 'openai/gpt-4.1-mini' },
      ...overrides.stepFinish,
    } as Parameters<NonNullable<typeof inst.onStepFinish>>[0])

    await inst.onFinish!({
      text: 'response',
      totalUsage: { inputTokens: 50, outputTokens: 25 },
      ...overrides.finish,
    } as Parameters<NonNullable<typeof inst.onFinish>>[0])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseBatch(): any[] {
    return JSON.parse(fetchSpy.mock.calls[0][1].body).batch
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findEvent(type: string): any {
    return parseBatch().find((e: Record<string, unknown>) => e.type === type)
  }

  it('collects events through lifecycle hooks and batches them', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, { withToolCall: true })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const batch = parseBatch()
    // trace-create, agent-create, generation-create, tool-create, generation-update, agent-update
    expect(batch).toHaveLength(6)

    const types = batch.map((e: Record<string, unknown>) => e.type)
    expect(types).toContain('trace-create')
    expect(types).toContain('agent-create')
    expect(types).toContain('generation-create')
    expect(types).toContain('tool-create')
    expect(types).toContain('generation-update')
    expect(types).toContain('agent-update')
  })

  it('creates correct parent-child relationships', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, { withToolCall: true })

    const batch = parseBatch()
    const traceEvent = batch.find(
      (e: Record<string, unknown>) => e.type === 'trace-create',
    )
    const agentCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'agent-create',
    )
    const generationCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'generation-create',
    )
    const toolCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'tool-create',
    )

    expect(agentCreate.body.traceId).toBe(traceEvent.body.id)
    expect(generationCreate.body.parentObservationId).toBe(agentCreate.body.id)
    expect(toolCreate.body.parentObservationId).toBe(generationCreate.body.id)
  })

  it('uses custom agentName', async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      agentName: 'conversation-grouper',
    })
    await runLifecycle(integration)

    const agentCreate = findEvent('agent-create')
    expect(agentCreate.body.name).toBe('conversation-grouper')
  })

  it('defaults agentName to rubytw-assistant', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration)

    const agentCreate = findEvent('agent-create')
    expect(agentCreate.body.name).toBe('rubytw-assistant')
  })

  it('skipAgentSpan skips agent creation and uses parentId for generation', async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      skipAgentSpan: true,
      parentId: 'parent-id',
    })
    await runLifecycle(integration)

    const batch = parseBatch()
    const types = batch.map((e: Record<string, unknown>) => e.type)

    expect(types).not.toContain('agent-create')
    expect(types).not.toContain('agent-update')

    const genCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'generation-create',
    )
    expect(genCreate.body.parentObservationId).toBe('parent-id')
  })

  it('skipAgentSpan without parentId sets generation parent to null', async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      skipAgentSpan: true,
    })
    await runLifecycle(integration)

    const batch = parseBatch()
    const genCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'generation-create',
    )
    expect(genCreate.body.parentObservationId).toBeNull()
  })

  it('agent-update closes at onFinish', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, {
      finish: { text: 'final response' },
    })

    const batch = parseBatch()
    const agentCreate = batch.find(
      (e: Record<string, unknown>) => e.type === 'agent-create',
    )
    const agentUpdate = batch.find(
      (e: Record<string, unknown>) =>
        e.type === 'agent-update' &&
        (e.body as Record<string, unknown>).id === agentCreate.body.id,
    )

    expect(agentUpdate).toBeDefined()
    expect(agentUpdate.body.output).toBe('final response')
    expect(agentUpdate.body.endTime).toBeDefined()
  })

  it('generation includes input with system and messages', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, {
      stepFinish: {
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    const generationCreate = findEvent('generation-create')
    expect(generationCreate.body.input).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ])
  })

  it('generation output includes reasoning when present', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, {
      stepFinish: { reasoningText: 'I think this because...' },
    })

    const generationUpdate = findEvent('generation-update')
    expect(generationUpdate.body.output).toEqual({
      text: 'response',
      reasoning: 'I think this because...',
    })
  })

  it('generation output omits reasoning when absent', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration)

    const generationUpdate = findEvent('generation-update')
    expect(generationUpdate.body.output).toEqual({ text: 'response' })
  })

  it('usage includes total and unit TOKENS', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, {
      stepFinish: {
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      },
    })

    const generationUpdate = findEvent('generation-update')
    expect(generationUpdate.body.usage).toEqual({
      input: 50,
      output: 25,
      total: 75,
      unit: 'TOKENS',
    })
  })

  it('tool-create has complete data from start and finish', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration, { withToolCall: true })

    const toolCreate = findEvent('tool-create')
    expect(toolCreate).toBeDefined()
    expect(toolCreate.body.name).toBe('memory_read')
    expect(toolCreate.body.output).toEqual([{ key: 'test' }])
    expect(toolCreate.body.startTime).toBeDefined()
    expect(toolCreate.body.endTime).toBeDefined()
    expect(toolCreate.body.metadata).toEqual({
      durationMs: 100,
      success: true,
    })
  })

  it('flushes on onFinish', async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer })
    await runLifecycle(integration)

    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
