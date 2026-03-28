# Ruby Taiwan Assistant

A Cloudflare Worker that provides automated information aggregation and query tools for [Ruby Taiwan](https://ruby.tw) community operators. It integrates with Discord and GitHub to deliver daily AI summaries and slash command queries.

## Features

- **Daily AI Summary** — Collects Discord channel messages on a schedule, processes them through a two-phase AI pipeline (conversation grouping + action item generation), and posts structured action items back to Discord
- **Discord Slash Commands** — Operators query GitHub Issues and Project status directly from Discord
- **GitHub App Integration** — Read-only access to GitHub Projects and Issues via GitHub App

## Tech Stack

- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Framework**: [Hono](https://hono.dev/)
- **Language**: TypeScript
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai/) with Workers AI via AI Gateway
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

See [SPEC.md](./SPEC.md) for the full specification.

## License

[Apache-2.0](./LICENSE)
