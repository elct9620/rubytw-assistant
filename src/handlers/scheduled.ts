import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import { TOKENS } from '../tokens'

export async function scheduledHandler(
  controller: ScheduledController,
): Promise<void> {
  console.log(
    `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
  )

  const usecase = container.resolve(GenerateSummary)
  const channelId = container.resolve<string>(TOKENS.DiscordChannelId)
  const hours = container.resolve<number>(TOKENS.SummaryHours)
  await usecase.execute(channelId, hours)
}
