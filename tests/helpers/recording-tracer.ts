export interface RecordedSpan {
  name: string
  attributes: Record<string, boolean | number | string | undefined>
  exceptions: { name?: string; message?: string }[]
  parent?: RecordedSpan
}

/**
 * Stands in for the runtime's `tracing`, which records nothing inside tests.
 * Parents follow the callbacks still running, which holds for the sequential
 * steps an agent run takes.
 */
export function recordingTracer() {
  const spans: RecordedSpan[] = []
  const open: RecordedSpan[] = []

  const enterSpan = <T>(name: string, callback: (span: Span) => T): T => {
    const recorded: RecordedSpan = {
      name,
      attributes: {},
      exceptions: [],
      parent: open[open.length - 1],
    }
    spans.push(recorded)
    open.push(recorded)

    const span = {
      isTraced: true,
      setAttribute(key: string, value: boolean | number | string) {
        recorded.attributes[key] = value
        return span
      },
      setAttributes(
        attributes: Record<string, boolean | number | string | undefined>,
      ) {
        Object.assign(recorded.attributes, attributes)
        return span
      },
      recordException(exception: { name?: string; message?: string }) {
        recorded.exceptions.push(exception)
      },
    } as unknown as Span

    const close = () => open.splice(open.indexOf(recorded), 1)
    try {
      const result = callback(span)
      if (result instanceof Promise) {
        return result.finally(close) as T
      }
      close()
      return result
    } catch (error) {
      close()
      throw error
    }
  }

  return {
    tracer: { enterSpan } as Pick<Tracing, 'enterSpan'>,
    spans,
    find: (name: string) => spans.find((span) => span.name === name),
  }
}
