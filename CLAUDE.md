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

- `src/index.ts` — App entrypoint, exports `ExportedHandler<Env>` with both `fetch` (Hono app) and `scheduled` (cron) handlers
- `tests/` — Test files using Vitest; tests import the worker and call `worker.fetch()` directly (not `app.request()`)
- `wrangler.jsonc` — Cloudflare Workers configuration (bindings, cron triggers, compatibility settings)
- `worker-configuration.d.ts` — Auto-generated types from `cf-typegen`; do not edit manually

### Worker Export Pattern

The default export uses `satisfies ExportedHandler<Env>` to combine Hono's fetch handler with the scheduled handler:

```ts
export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController) { /* ... */ },
} satisfies ExportedHandler<Env>
```

### Testing Pattern

Tests use `cloudflare:test` helpers for the Workers runtime environment:
- `env` — provides bindings defined in `wrangler.jsonc`
- `createScheduledController()` / `createExecutionContext()` / `waitOnExecutionContext()` — for testing scheduled handlers

## Key Conventions

- Hono app should use `Env` generic for type-safe bindings: `new Hono<{ Bindings: Env }>()`
- Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, not Node.js
- ESLint ignores `dist/`, `.wrangler/`, and `worker-configuration.d.ts`
- Secrets are managed via `wrangler secret put` (DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_INSTALLATION_ID)
- Cron trigger runs at `0 16 * * *` UTC (midnight Taiwan time, UTC+8)
