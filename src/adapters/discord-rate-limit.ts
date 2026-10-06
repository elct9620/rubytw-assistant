/**
 * Paces Discord requests by the limits Discord reports on each response
 * (https://docs.discord.com/developers/topics/rate-limits): requests to one
 * route go out one at a time, and wait while that route's limit is spent or
 * after Discord refused one, instead of being sent into a refusal.
 */
export class DiscordRateLimiter {
  private queues = new Map<string, Promise<unknown>>()
  private resumeAt = new Map<string, number>()

  fetch(route: string, url: string, init?: RequestInit): Promise<Response> {
    const previous = this.queues.get(route) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.send(route, url, init))
    this.queues.set(route, next)
    return next
  }

  private async send(
    route: string,
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const wait = (this.resumeAt.get(route) ?? 0) - Date.now()
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }

    const response = await fetch(url, init)
    const waitSeconds =
      response.status === 429
        ? Number(response.headers.get('Retry-After'))
        : response.headers.get('X-RateLimit-Remaining') === '0'
          ? Number(response.headers.get('X-RateLimit-Reset-After'))
          : 0
    if (waitSeconds > 0) {
      this.resumeAt.set(route, Date.now() + waitSeconds * 1000)
    }
    return response
  }
}
