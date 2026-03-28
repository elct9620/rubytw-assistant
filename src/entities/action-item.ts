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

export function formatActionItems(items: ActionItem[]): string {
  return items
    .map(
      (item) =>
        `- [${item.status}] ${item.description} (${item.assignee}) — ${item.reason}`,
    )
    .join('\n')
}
