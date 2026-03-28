import { container } from '../container'
import {
  GenerateSummary,
  type SummaryPresenter,
} from '../usecases/generate-summary'
import { TOKENS } from '../tokens'

export async function scheduledHandler(
  controller: ScheduledController,
): Promise<void> {
  console.log(
    `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
  )

  const usecase = container.resolve(GenerateSummary)
  const presenter = container.resolve<SummaryPresenter>(TOKENS.SummaryPresenter)
  const hours = container.resolve<number>(TOKENS.SummaryHours)

  const result = await usecase.execute(hours)
  await presenter.present(result)
}
