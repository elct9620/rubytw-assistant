import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // The Langfuse/OTel export path pulls a sizeable module graph into the
    // Worker, and the first test to touch the bundled entry point pays the
    // whole load cost before it can assert anything.
    testTimeout: 15_000,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { DEBUG_MODE: 'true' },
      },
    }),
  ],
})
