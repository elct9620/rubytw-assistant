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
- `src/adapters/` — **Outbound Gateways**: implement port interfaces for external services (Discord API, AI Gateway, KV). Adapters use `@inject()` decorators for DI.
- `src/prompts/` — **Prompt Templates**: markdown files used as AI prompt templates (e.g., `generate-action-items.md`, `group-conversations.md`)

Dependencies point inward: handlers/adapters → usecases. Port interfaces are defined in the use case layer (`usecases/ports.ts`), not in handlers or adapters.

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
- Use case tests use stub implementations of port interfaces, not the Workers test helpers
- **MSW (Mock Service Worker)** intercepts external HTTP calls in tests. A global MSW server is set up in `tests/setup.ts` with `onUnhandledRequest: 'error'` — any unmocked external request will fail the test. Add per-test handlers via `server.use()` from `tests/msw-server.ts`.

## Key Conventions

- Hono app should use `Env` generic for type-safe bindings: `new Hono<{ Bindings: Env }>()`
- Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, not Node.js
- ESLint ignores `dist/`, `.wrangler/`, and `worker-configuration.d.ts`
- Production secrets are deployed via `wrangler secret put`; local secrets go in `.dev.vars` (see Configuration Files above)
- Cron trigger runs at `0 16 * * *` UTC (midnight Taiwan time, UTC+8)
