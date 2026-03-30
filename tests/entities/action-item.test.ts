import { describe, it, expect } from 'vitest'
import {
  formatActionItems,
  type ActionItem,
} from '../../src/entities/action-item'

describe('formatActionItems', () => {
  it('should format action items with status, description, assignee, and reason', () => {
    const items: ActionItem[] = [
      {
        status: 'to-do',
        description: '更新官網',
        assignee: 'Alice',
        reason: '官網資訊過舊',
      },
      {
        status: 'in-progress',
        description: '準備活動',
        assignee: 'Bob',
        reason: '下週舉辦',
      },
    ]

    expect(formatActionItems(items)).toBe(
      '- [待辦] 更新官網 (Alice) — 官網資訊過舊\n- [進度] 準備活動 (Bob) — 下週舉辦',
    )
  })

  it('should omit assignee parentheses when assignee is null', () => {
    const items: ActionItem[] = [
      {
        status: 'stalled',
        description: '尚未有志願者負責線上聚會主持工作',
        assignee: null,
        reason: '導致活動籌備停滯',
      },
    ]

    expect(formatActionItems(items)).toBe(
      '- [停滯] 尚未有志願者負責線上聚會主持工作 — 導致活動籌備停滯',
    )
  })

  it('should return empty string for empty array', () => {
    expect(formatActionItems([])).toBe('')
  })

  it('should handle all status types', () => {
    const items: ActionItem[] = [
      {
        status: 'done',
        description: '任務一',
        assignee: 'A',
        reason: '原因一',
      },
      {
        status: 'stalled',
        description: '任務二',
        assignee: 'B',
        reason: '原因二',
      },
      {
        status: 'discussion',
        description: '任務三',
        assignee: 'C',
        reason: '原因三',
      },
    ]

    const result = formatActionItems(items)
    expect(result).toContain('- [完成]')
    expect(result).toContain('- [停滯]')
    expect(result).toContain('- [討論]')
  })
})
