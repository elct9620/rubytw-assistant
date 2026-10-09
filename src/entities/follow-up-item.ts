/** A listed item is a reminder: stalled this run, or let go after its reminder. */
export type FollowUpStatus = 'stalled' | 'abandoned'

export interface FollowUpItem {
  status: FollowUpStatus
  description: string
  assignee: string | null
  /** ISO date of the item's newest evidence. */
  lastProgress: string
  reason: string
}

const STATUS_LABELS: Record<FollowUpStatus, string> = {
  stalled: '停滯',
  abandoned: '已放棄',
}

/** `2026-09-08` → `9/8`, short enough to sit inside the reason; any other form is shown as written. */
function monthDay(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  return match ? `${Number(match[1])}/${Number(match[2])}` : date
}

export function formatFollowUpItems(items: FollowUpItem[]): string {
  return items
    .map((item) => {
      const assignee = item.assignee ? ` (${item.assignee})` : ''
      return `- [${STATUS_LABELS[item.status]}] ${item.description}${assignee} — ${item.reason}，最後進展 ${monthDay(item.lastProgress)}`
    })
    .join('\n')
}
