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

- `src/index.ts` — **Composition root**: wires dependencies and exports `ExportedHandler<Env>` with `fetch` (Hono) and `scheduled` (cron) handlers
- `src/usecases/` — **Use Cases**: application logic + port interfaces (e.g., `GenerateSummary` defines `GitHubSource`, `DiscordSource`, `AIService`, `DiscordNotifier` interfaces)
- `src/handlers/` — **Inbound Handlers**: entry points that bridge framework/runtime calls to use cases (e.g., `scheduled.ts` for cron triggers, `health.ts` for HTTP health check). Hono HTTP handlers use the sub-app pattern (`app.route()`).
- `src/adapters/` — **Outbound Gateways**: implement use case port interfaces for external services (e.g., `discord-notifier.ts` implements `DiscordNotifier`). Gateways accept a `fetchFn` parameter (defaults to global `fetch`) for testability.

Dependencies point inward: handlers/adapters → usecases. Port interfaces are defined in the use case layer, not in handlers or adapters.

### Composition Pattern

Dependencies are constructed **inside handler scope** via factory functions, not at module scope. This is required because Cloudflare Workers `Env` bindings (secrets) are only available within `fetch`/`scheduled` handler invocations.

```ts
const scheduledHandler = createScheduledHandler((env) => ({
  usecase: new GenerateSummary({
    /* adapters using env */
  }),
  channelId: env.DISCORD_CHANNEL_ID,
  hours: Number(env.SUMMARY_HOURS),
}))
```

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

## Key Conventions

- Hono app should use `Env` generic for type-safe bindings: `new Hono<{ Bindings: Env }>()`
- Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, not Node.js
- ESLint ignores `dist/`, `.wrangler/`, and `worker-configuration.d.ts`
- Production secrets are deployed via `wrangler secret put`; local secrets go in `.dev.vars` (see Configuration Files above)
- Cron trigger runs at `0 16 * * *` UTC (midnight Taiwan time, UTC+8)
