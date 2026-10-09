/** Taiwan keeps UTC+8 all year, with no daylight saving. */
const TAIWAN_OFFSET_MS = 8 * 3600 * 1000

/** The `YYYY-MM-DD` date in Taiwan at that instant. */
export function taiwanDate(at: Date = new Date()): string {
  return new Date(at.getTime() + TAIWAN_OFFSET_MS).toISOString().slice(0, 10)
}
