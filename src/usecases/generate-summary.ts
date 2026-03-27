export interface GitHubSource {
  getIssues(): Promise<string[]>
  getProjectActivities(): Promise<string[]>
}

export interface DiscordSource {
  getChannelMessages(hours: number): Promise<string[]>
}

export interface AIService {
  generateSummary(data: string): Promise<string>
}

export interface DiscordNotifier {
  sendMessage(channelId: string, content: string): Promise<void>
}

export interface GenerateSummaryDeps {
  github: GitHubSource
  discord: DiscordSource
  ai: AIService
  notifier: DiscordNotifier
}

export class GenerateSummary {
  constructor(private deps: GenerateSummaryDeps) {}

  async execute(channelId: string, hours: number): Promise<void> {
    const [issues, activities, messages] = await Promise.all([
      this.deps.github.getIssues(),
      this.deps.github.getProjectActivities(),
      this.deps.discord.getChannelMessages(hours),
    ])

    const data = [...issues, ...activities, ...messages].join('\n')
    const summary = await this.deps.ai.generateSummary(data)
    await this.deps.notifier.sendMessage(channelId, summary)
  }
}
