export type FollowUpStatus = 'to-do' | 'in-progress' | 'stalled' | 'abandoned'

export interface FollowUpItem {
  status: FollowUpStatus
  description: string
  assignee: string | null
  /** ISO date of the item's newest evidence. */
  lastProgress: string
  reason: string
}

const STATUS_LABELS: Record<FollowUpStatus, string> = {
  'to-do': '待辦',
  'in-progress': '進行中',
  stalled: '停滯',
  abandoned: '已放棄',
}

const DATED_STATUSES = new Set<FollowUpStatus>(['stalled', 'abandoned'])

/** `2026-09-08` → `9/8`, short enough to sit inside the reason; any other form is shown as written. */
function monthDay(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  return match ? `${Number(match[1])}/${Number(match[2])}` : date
}

export function formatFollowUpItems(items: FollowUpItem[]): string {
  return items
    .map((item) => {
      const assignee = item.assignee ? ` (${item.assignee})` : ''
      const progress = DATED_STATUSES.has(item.status)
        ? `，最後進展 ${monthDay(item.lastProgress)}`
        : ''
      return `- [${STATUS_LABELS[item.status]}] ${item.description}${assignee} — ${item.reason}${progress}`
    })
    .join('\n')
}
