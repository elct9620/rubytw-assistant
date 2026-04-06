import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
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
  const trace = setupTrace(child, {})

  const usecase = child.resolve(GenerateSummary)
  const presenter = child.resolve<SummaryPresenter>(TOKENS.SummaryPresenter)
  const hours = child.resolve<number>(TOKENS.SummaryHours)

  const run = async () => {
    const result = await usecase.execute(hours)
    await presenter.present(result)
  }

  if (trace) {
    const tracer = child.resolve<Tracer>(TOKENS.Tracer)
    const traceInput = { cron: controller.cron }
    await tracer.startActiveSpan(
      'generate-summary',
      {
        attributes: {
          ...traceInput,
          'langfuse.trace.input': JSON.stringify(traceInput),
        },
      },
      async (span) => {
        try {
          await run()
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.recordException(err)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          })
          span.setAttribute(
            'langfuse.trace.output',
            JSON.stringify({ error: err.message, stack: err.stack }),
          )
          throw error
        } finally {
          span.end()
          await trace.provider.forceFlush()
        }
      },
    )
  } else {
    await run()
  }
}
