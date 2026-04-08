import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryPresenter } from '../usecases/ports'
import { TOKENS } from '../tokens'
import { runWithTrace, setupTrace } from './telemetry-setup'
import { summarizeResult } from './summarize-result'

export async function scheduledHandler(
  controller: ScheduledController,
): Promise<void> {
  console.log(
    `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
  )

  const child = container.createChildContainer()
  const trace = setupTrace(child, {})

  const usecase = child.resolve(GenerateSummary)
  const presenter = child.resolve<SummaryPresenter>(TOKENS.SummaryPresenter)
  const hours = child.resolve<number>(TOKENS.SummaryHours)

  await runWithTrace(child, trace, {
    spanName: 'generate-summary',
    input: { cron: controller.cron, hours },
    summarizeOutput: summarizeResult,
    fn: async () => {
      const result = await usecase.execute(hours)
      await presenter.present(result)
      return result
    },
  })
}
