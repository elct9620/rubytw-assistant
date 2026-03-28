export type FetchFn = typeof fetch

export function assertDiscordResponse(response: Response): void {
  if (!response.ok) {
    throw new Error(
      `Discord API error: ${response.status} ${response.statusText}`,
    )
  }
}
