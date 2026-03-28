export type ActionItemStatus =
  | 'to-do'
  | 'in-progress'
  | 'done'
  | 'stalled'
  | 'discussion'

export interface ActionItem {
  status: ActionItemStatus
  description: string
  assignee: string
  reason: string
}

const STATUS_LABELS: Record<ActionItemStatus, string> = {
  'to-do': '待辦',
  'in-progress': '進度',
  done: '完成',
  stalled: '停滯',
  discussion: '討論',
}

export function formatActionItems(items: ActionItem[]): string {
  return items
    .map(
      (item) =>
        `- [${STATUS_LABELS[item.status]}] ${item.description} (${item.assignee}) — ${item.reason}`,
    )
    .join('\n')
}
