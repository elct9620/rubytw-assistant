import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
import { container } from '../container'
import { GenerateSummary } from '../usecases/generate-summary'
import type { SummaryPresenter, SummaryResult } from '../usecases/ports'
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

  const run = async (): Promise<SummaryResult> => {
    const result = await usecase.execute(hours)
    await presenter.present(result)
    return result
  }

  if (trace) {
    const tracer = child.resolve<Tracer>(TOKENS.Tracer)
    // Use `langfuse.observation.*` (not `langfuse.trace.*`) so that the root
    // observation's input/output is rendered in the v4 Fast UI. Trace-level
    // attributes are deprecated in v4 and only kept for legacy evaluators.
    const observationInput = { cron: controller.cron, hours }
    await tracer.startActiveSpan(
      'generate-summary',
      {
        attributes: {
          'langfuse.observation.input': JSON.stringify(observationInput),
        },
      },
      async (span) => {
        try {
          const result = await run()
          span.setAttribute(
            'langfuse.observation.output',
            JSON.stringify({
              topicGroupCount: result.topicGroups.length,
              actionItemCount: result.actionItems.length,
            }),
          )
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.recordException(err)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          })
          span.setAttribute(
            'langfuse.observation.output',
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
