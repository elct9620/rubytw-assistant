export type FollowUpStatus = 'to-do' | 'in-progress' | 'stalled' | 'abandoned'

export interface FollowUpItem {
  status: FollowUpStatus
  description: string
  assignee: string | null
  /** ISO date people last moved the item, or null when no movement was found. */
  lastProgress: string | null
  reason: string
}

const STATUS_LABELS: Record<FollowUpStatus, string> = {
  'to-do': '待辦',
  'in-progress': '進行中',
  stalled: '停滯',
  abandoned: '已放棄',
}

export function formatFollowUpItems(items: FollowUpItem[]): string {
  return items
    .map((item) => {
      const assignee = item.assignee ? ` (${item.assignee})` : ''
      const progress = item.lastProgress
        ? `最後進展 ${item.lastProgress}`
        : '尚無進展紀錄'
      return `- [${STATUS_LABELS[item.status]}] ${item.description}${assignee} — ${progress} — ${item.reason}`
    })
    .join('\n')
}
