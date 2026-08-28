import { injectable, inject } from 'tsyringe'
import type { GuildRoleChecker } from '../usecases/ports'
import { assertDiscordResponse } from './shared'
import { withRetry } from '../services/retry'
import { TOKENS } from '../tokens'

interface DiscordGuildMember {
  roles: string[]
}

@injectable()
export class DiscordGuildRoleAdapter implements GuildRoleChecker {
  constructor(
    @inject(TOKENS.DiscordBotToken) private botToken: string,
    @inject(TOKENS.DiscordGuildId) private guildId: string,
    @inject(TOKENS.DiscordOperatorRoleId) private operatorRoleId: string,
  ) {}

  async hasOperatorRole(userId: string): Promise<boolean> {
    return withRetry(
      async () => {
        const response = await fetch(
          `https://discord.com/api/v10/guilds/${this.guildId}/members/${userId}`,
          { headers: { Authorization: `Bot ${this.botToken}` } },
        )

        // Discord answers 404 for a user who never joined the guild.
        if (response.status === 404) {
          return false
        }

        await assertDiscordResponse(response)
        const member = (await response.json()) as DiscordGuildMember
        return member.roles.includes(this.operatorRoleId)
      },
      {
        onRetry: (error, attempt) => {
          console.warn(
            `Discord guild member lookup retry ${attempt}:`,
            error instanceof Error ? error.message : error,
          )
        },
      },
    )
  }
}
