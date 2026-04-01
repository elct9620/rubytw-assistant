import { container } from 'tsyringe'
import { describe, it, expect } from 'vitest'
import { TOKENS } from '../../src/tokens'
import { DiscordNotifierAdapter } from '../../src/adapters/discord-notifier'
import { DiscordSourceAdapter } from '../../src/adapters/discord-source'

describe('Discord adapter DI resolution', () => {
  it('should resolve DiscordNotifierAdapter via useClass without error', () => {
    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'test-bot-token' })
    child.register(TOKENS.DiscordNotifier, {
      useClass: DiscordNotifierAdapter,
    })

    expect(() => child.resolve(TOKENS.DiscordNotifier)).not.toThrow()
  })

  it('should resolve DiscordSourceAdapter via useClass without error', () => {
    const child = container.createChildContainer()
    child.register(TOKENS.DiscordBotToken, { useValue: 'test-bot-token' })
    child.register(TOKENS.DiscordChannelId, { useValue: 'test-channel-id' })
    child.register(TOKENS.DiscordSource, { useClass: DiscordSourceAdapter })

    expect(() => child.resolve(TOKENS.DiscordSource)).not.toThrow()
  })
})
