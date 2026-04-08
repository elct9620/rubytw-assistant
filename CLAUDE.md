# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ruby Taiwan Assistant — a Cloudflare Worker that provides automated information aggregation and query tools for Ruby Taiwan community operators. It integrates with Discord (Interaction Webhook, Bot API) and GitHub (App) to deliver daily AI summaries and slash command queries. See SPEC.md for full specification.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (web framework)
- **Language**: TypeScript (ESNext, Bundler module resolution)
- **Package Manager**: pnpm
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers` (tests run in Workers runtime)
- **Linting**: ESLint + typescript-eslint + eslint-config-prettier
- **Formatting**: Prettier (no semicolons, single quotes)

## Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Start local dev server (wrangler dev)
pnpm run test         # Run tests once
pnpm run test:watch   # Run tests in watch mode
pnpm run lint         # Lint with ESLint
pnpm run format       # Format with Prettier
pnpm run format:check # Check formatting
pnpm run cf-typegen   # Regenerate CloudflareBindings types from wrangler.jsonc
pnpm run deploy       # Deploy to Cloudflare Workers

# Run a single test file
pnpm vitest run tests/index.test.ts
```

## Architecture

### Layered Structure (Clean Architecture)

- `src/index.ts` — **Entry point**: imports the DI container, mounts Hono routes, and exports `ExportedHandler<Env>` with `fetch` (Hono) and `scheduled` (cron) handlers
- `src/container.ts` — **Composition root**: registers all DI bindings (env values, port→adapter mappings, use case factories) using tsyringe
- `src/tokens.ts` — **DI tokens**: string-based injection tokens for env bindings and port interfaces
- `src/usecases/` — **Use Cases**: application logic. Port interfaces live in `ports.ts`. Use cases accept deps via constructor (plain object), not DI decorators.
- `src/entities/` — **Domain Entities**: value objects and domain logic (e.g., `TopicGroup`, `ActionItem`, `MemoryEntry`)
- `src/handlers/` — **Inbound Handlers**: bridge framework/runtime calls to use cases (e.g., `scheduled.ts` for cron, `health.ts` for HTTP). Hono HTTP handlers use the sub-app pattern (`app.route()`).
- `src/services/` — **Application Services**: orchestrate multiple ports and libraries to implement use case port interfaces (e.g., `ConversationGrouperService` coordinates AI SDK + tools to implement `ConversationGrouper` port). Services use `@inject()` decorators for DI, same as adapters.
- `src/adapters/` — **Outbound Gateways**: thin wrappers for external API communication (Discord API, GitHub API, KV). Adapters use `@inject()` decorators for DI. Unlike services, adapters only handle data format conversion — no orchestration logic.
- `src/prompts/` — **Prompt Templates**: markdown files used as AI prompt templates (e.g., `generate-action-items.md`, `group-conversations.md`)

Dependencies point inward: handlers/services/adapters → usecases. Port interfaces are defined in the use case layer (`usecases/ports.ts`), not in handlers, services, or adapters.

### Request Lifecycle

Handlers create a **child container** per request/cron trigger via `container.createChildContainer()` for isolation. The flow:

1. Handler creates child container
2. `setupTrace()` (in `src/handlers/telemetry-setup.ts`) creates an OTel `TracerProvider` via `@aotoki/edge-otel` (if Langfuse keys are configured) and registers the resulting `Tracer` under `TOKENS.Tracer` in the child container
3. Use case is resolved from child container, executed inside a root OTel span, and result presented
4. `finally` block flushes telemetry via `provider.forceFlush()`

### Telemetry (Langfuse)

- **Optional**: telemetry activates only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present; otherwise `setupTrace()` returns `undefined` and handlers run without instrumentation
- Traces are emitted via the standard OTel API (`@opentelemetry/api`) and exported by `@aotoki/edge-otel`'s Langfuse exporter
- Handlers wrap use case execution in a root `startActiveSpan` and attach `langfuse.observation.input`/`langfuse.observation.output` attributes so the root observation renders correctly in the Langfuse v4 Fast UI
- The AI SDK's `generateText` is instrumented via `experimental_telemetry: { isEnabled: true, tracer }` inside the services, producing a trace hierarchy: root span → generation → tool spans

### Prompt Templates

Markdown files in `src/prompts/` are imported as strings via a custom type declaration (`text-modules.d.ts` + wrangler text rule). Templates use `{{variable}}` placeholders replaced via string interpolation in services.

### DI Container (tsyringe)

The project uses tsyringe for dependency injection. Env bindings are accessed at module scope via `import { env } from 'cloudflare:workers'` and registered as values. Use cases are registered with `useFactory` so they receive plain dep objects (no DI decorators on use case classes).

```ts
// container.ts — registering an adapter and a use case
container.register(TOKENS.DiscordSource, { useClass: DiscordSourceAdapter })
container.register(GenerateSummary, {
  useFactory: (c) =>
    new GenerateSummary({
      discord: c.resolve(TOKENS.DiscordSource),
      // ...
    }),
})
```

When adding a new dependency: define a token in `tokens.ts`, register in `container.ts`, and resolve where needed.

### Configuration Files

- `wrangler.jsonc` — Cloudflare Workers configuration (bindings, cron triggers, compatibility settings)
- `worker-configuration.d.ts` — Auto-generated types from `cf-typegen`; do not edit manually
- `.dev.vars` — Local secret placeholders (gitignored); used by `cf-typegen` to generate `Env` types for secrets. Copy from `.dev.vars.example` and fill in real values for local dev. After adding new secrets, run `pnpm run cf-typegen` to regenerate types.

### Testing Pattern

Tests use `cloudflare:test` helpers for the Workers runtime environment:

- `env` — provides bindings defined in `wrangler.jsonc`
- `createScheduledController()` / `createExecutionContext()` / `waitOnExecutionContext()` — for testing scheduled handlers
- Tests import the worker and call `worker.fetch()` / `worker.scheduled()` directly (not `app.request()`)
- Use case tests use stub implementations of port interfaces (stubs in `tests/services/stubs.ts`), not the Workers test helpers
- **MSW (Mock Service Worker)** intercepts external HTTP calls in tests. A global MSW server is set up in `tests/setup.ts` with `onUnhandledRequest: 'error'` — any unmocked external request will fail the test. Add per-test handlers via `server.use()` from `tests/msw-server.ts`.
- Tests call `container.clearInstances()` before each test to reset DI state

## Key Conventions

- Hono app should use `Env` generic for type-safe bindings: `new Hono<{ Bindings: Env }>()`
- Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, not Node.js
- ESLint ignores `dist/`, `.wrangler/`, and `worker-configuration.d.ts`
- Production secrets are deployed via `wrangler secret put`; local secrets go in `.dev.vars` (see Configuration Files above)
- Cron trigger runs at `0 16 * * *` UTC (midnight Taiwan time, UTC+8)
- Services use AI SDK's `generateText()` with Zod schemas for structured output extraction
- Services constrain AI tool loops with `stepCountIs(MAX_TOOL_STEPS)`
- AI model is created via `createAIModel(config)` which chains through AI Gateway
- Debug endpoint at `/debug/summary?channel_id=X&hours=Y` for dev-only summary previews
- Compatibility flag `nodejs_compat` is enabled for crypto API support
