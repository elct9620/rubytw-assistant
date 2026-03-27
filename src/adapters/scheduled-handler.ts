import { GenerateSummary } from '../usecases/generate-summary'

export function createScheduledHandler(
  usecase: GenerateSummary,
  channelId: string,
  hours: number,
) {
  return async (controller: ScheduledController) => {
    console.log(
      `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
    )
    await usecase.execute(channelId, hours)
  }
}
