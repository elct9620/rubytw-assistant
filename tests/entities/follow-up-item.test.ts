import { describe, it, expect } from 'vitest'
import {
  formatFollowUpItems,
  type FollowUpItem,
} from '../../src/entities/follow-up-item'

describe('formatFollowUpItems', () => {
  it('should show status, description, assignee, last progress, and reason on one line each', () => {
    const items: FollowUpItem[] = [
      {
        status: 'to-do',
        description: '寄出贊助報告',
        assignee: 'Kasa',
        lastProgress: '2026-10-01',
        reason: '贊助商等待中',
      },
      {
        status: 'in-progress',
        description: '確認 11 月場地',
        assignee: '竜堂',
        lastProgress: '2026-10-05',
        reason: '已聯絡場地方',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [待辦] 寄出贊助報告 (Kasa) — 最後進展 2026-10-01 — 贊助商等待中\n' +
        '- [進行中] 確認 11 月場地 (竜堂) — 最後進展 2026-10-05 — 已聯絡場地方',
    )
  })

  it('should leave out the assignee and say no progress was found when either is missing', () => {
    const items: FollowUpItem[] = [
      {
        status: 'stalled',
        description: '徵求線上聚會主持人',
        assignee: null,
        lastProgress: null,
        reason: '無人回應',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [停滯] 徵求線上聚會主持人 — 尚無進展紀錄 — 無人回應',
    )
  })
})
