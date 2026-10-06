# Ruby Taiwan Assistant

A Cloudflare Worker that provides automated information aggregation and query tools for [Ruby Taiwan](https://ruby.tw) community operators. It integrates with Discord and GitHub to deliver a daily AI follow-up of unfinished work and slash command queries.

## Features

- **Daily Follow-up** — Collects Discord channel messages on a schedule; a Follow-up Agent checks memory, the channel's history, and GitHub Issues, then posts what is still unfinished and when it last moved. A Memory Agent then clears finished and stale memory and condenses the rest for the next run
- **Discord Slash Commands** — Operators query GitHub Issues and Project status directly from Discord
- **GitHub App Integration** — Read-only access to GitHub Projects and Issues via GitHub App

## Tech Stack

- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Framework**: [Hono](https://hono.dev/)
- **Language**: TypeScript
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai/) agents, reaching models through AI Gateway via the Workers AI binding
- **Testing**: [Vitest](https://vitest.dev/) with [@cloudflare/vitest-pool-workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/)
- [Cloudflare account](https://dash.cloudflare.com/) with Workers enabled

### Setup

```bash
pnpm install
cp .dev.vars.example .dev.vars
# Fill in your secrets in .dev.vars
pnpm run cf-typegen
```

### Development

```bash
pnpm run dev        # Start local dev server (wrangler)
pnpm run test       # Run tests
pnpm run lint       # Lint
pnpm run format     # Format
```

### Deployment

```bash
pnpm run deploy
```

Production secrets are managed via `wrangler secret put`.

## Configuration

| Variable                 | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `DISCORD_PUBLIC_KEY`     | Discord application public key for webhook verification    |
| `DISCORD_BOT_TOKEN`      | Discord bot token for sending messages and reading history |
| `DISCORD_CHANNEL_ID`     | Target channel for summary delivery and message collection |
| `GITHUB_APP_ID`          | GitHub App ID                                              |
| `GITHUB_PRIVATE_KEY`     | GitHub App private key                                     |
| `GITHUB_INSTALLATION_ID` | GitHub App installation ID                                 |
| `AI_GATEWAY_ID`          | AI Gateway the `AI` binding routes model calls through     |
| `AI_MODEL`               | Model the agents use                                       |
| `FOLLOWUP_TOKEN_BUDGET`  | Token ceiling for one Follow-up Agent run                  |

See [SPEC.md](./SPEC.md) for the full specification.

## License

[Apache-2.0](./LICENSE)
