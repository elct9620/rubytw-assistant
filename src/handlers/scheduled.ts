import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryPresenter } from '../usecases/ports'
import { TOKENS, type LangfuseConfig } from '../tokens'
import type { RequestContext } from '../context'
import { createTelemetryContext } from '../telemetry/context'

export async function scheduledHandler(
  controller: ScheduledController,
): Promise<void> {
  console.log(
    `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
  )

  const child = container.createChildContainer()

  const config = child.resolve<LangfuseConfig | null>(TOKENS.LangfuseConfig)
  const { tracer } = createTelemetryContext(config)
  const ctx: RequestContext = {}
  if (tracer) {
    ctx.traceId = tracer.createTrace({
      name: 'generate-summary',
      input: { cron: controller.cron },
    })
  }
  child.register(TOKENS.RequestContext, { useValue: ctx })

  const usecase = child.resolve(GenerateSummary)
  const presenter = child.resolve<SummaryPresenter>(TOKENS.SummaryPresenter)
  const hours = child.resolve<number>(TOKENS.SummaryHours)

  const result = await usecase.execute(hours)
  await presenter.present(result)

  await tracer?.flush()
}
