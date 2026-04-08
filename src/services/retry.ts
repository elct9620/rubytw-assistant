export interface RetryOptions {
  /** Maximum number of attempts including the first call. Default 3. */
  attempts?: number
  /** Base delay in milliseconds; doubles after each failure. Default 100. */
  baseMs?: number
  /** Optional hook for observability; called after each retryable failure. */
  onRetry?: (error: unknown, attempt: number) => void
}

/**
 * Run `fn` with exponential backoff retry. Implements the
 * "Exponential Backoff Retry" pattern from SPEC.md: up to N attempts,
 * doubling delay between attempts. After the final attempt fails, the
 * last error is rethrown so callers can apply their own degradation.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const baseMs = options.baseMs ?? 100

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      options.onRetry?.(error, attempt)
      await sleep(baseMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
