import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryPresenter } from '../usecases/ports'
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
