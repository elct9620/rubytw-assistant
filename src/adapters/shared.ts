import { RateLimitedError } from '../usecases/ports'

export async function assertDiscordResponse(response: Response): Promise<void> {
  if (response.status === 429) {
    await response.body?.cancel()
    const retryAfter = response.headers.get('Retry-After') ?? 'unknown'
    throw new RateLimitedError(`Discord (Retry-After: ${retryAfter})`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body ? ` - ${body}` : ''
    throw new Error(
      `Discord API error: ${response.status} ${response.statusText}${detail}`,
    )
  }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
