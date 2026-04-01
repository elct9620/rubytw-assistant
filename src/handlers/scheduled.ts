import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryPresenter } from '../usecases/ports'
import { TOKENS } from '../tokens'
import { setupTrace } from './telemetry-setup'

export async function scheduledHandler(
  controller: ScheduledController,
): Promise<void> {
  console.log(
    `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
  )

  const child = container.createChildContainer()
  const tracer = setupTrace(child, {
    name: 'generate-summary',
    input: { cron: controller.cron },
  })

  const usecase = child.resolve(GenerateSummary)
  const presenter = child.resolve<SummaryPresenter>(TOKENS.SummaryPresenter)
  const hours = child.resolve<number>(TOKENS.SummaryHours)

  try {
    const result = await usecase.execute(hours)
    await presenter.present(result)
  } finally {
    await tracer?.flush()
  }
}
