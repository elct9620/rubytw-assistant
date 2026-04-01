export async function assertDiscordResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body ? ` - ${body}` : ''
    const retryAfter =
      response.status === 429
        ? ` (Retry-After: ${response.headers.get('Retry-After') ?? 'unknown'})`
        : ''
    throw new Error(
      `Discord API error: ${response.status} ${response.statusText}${retryAfter}${detail}`,
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
