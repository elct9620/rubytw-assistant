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
```

## Architecture

- `src/index.ts` — App entrypoint, exports a Hono app as the default export (Cloudflare Workers convention)
- `tests/` — Test files using Vitest; tests use `cloudflare:test` for the Workers environment and call `app.request()` directly
- `wrangler.jsonc` — Cloudflare Workers configuration (bindings, compatibility settings)
- `worker-configuration.d.ts` — Auto-generated types from `cf-typegen`; do not edit manually

## Key Conventions

- Hono app should use `Env` generic for type-safe bindings: `new Hono<{ Bindings: Env }>()`
- Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, not Node.js
- ESLint ignores `dist/`, `.wrangler/`, and `worker-configuration.d.ts`
