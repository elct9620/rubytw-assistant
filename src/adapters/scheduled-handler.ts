import type { GenerateSummary } from '../usecases/generate-summary'

export interface ScheduledHandlerConfig {
  usecase: GenerateSummary
  channelId: string
  hours: number
}

export type ConfigFactory = (env: Env) => ScheduledHandlerConfig

export function createScheduledHandler(factory: ConfigFactory) {
  return async (controller: ScheduledController, env: Env): Promise<void> => {
    console.log(
      `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
    )
    const { usecase, channelId, hours } = factory(env)
    await usecase.execute(channelId, hours)
  }
}
