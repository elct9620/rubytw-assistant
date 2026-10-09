import { describe, it, expect } from 'vitest'
import {
  formatFollowUpItems,
  type FollowUpItem,
} from '../../src/entities/follow-up-item'

describe('formatFollowUpItems', () => {
  it('should show status, description, assignee, and reason without a date for moving items', () => {
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
      {
        status: 'to-do',
        description: '訂購杯套',
        assignee: null,
        lastProgress: '2026-10-01',
        reason: '活動前需到貨',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [待辦] 寄出贊助報告 (Kasa) — 贊助商等待中\n' +
        '- [進行中] 確認 11 月場地 (竜堂) — 已聯絡場地方\n' +
        '- [待辦] 訂購杯套 — 活動前需到貨',
    )
  })

  it('should add the last progress as month and day to a stalled item', () => {
    const items: FollowUpItem[] = [
      {
        status: 'stalled',
        description: '追問 PicCollage 11/24 場地',
        assignee: 'Kasa',
        lastProgress: '2026-09-08',
        reason: '場地方未回覆',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [停滯] 追問 PicCollage 11/24 場地 (Kasa) — 場地方未回覆，最後進展 9/8',
    )
  })

  it('should show a last progress the model wrote in another form as it was written', () => {
    const items: FollowUpItem[] = [
      {
        status: 'stalled',
        description: '追問 PicCollage 場地',
        assignee: 'Kasa',
        lastProgress: '9/28',
        reason: '場地方未回覆',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [停滯] 追問 PicCollage 場地 (Kasa) — 場地方未回覆，最後進展 9/28',
    )
  })

  it('should mark an abandoned item so operators see it was let go', () => {
    const items: FollowUpItem[] = [
      {
        status: 'abandoned',
        description: '確認 SITCON 照片素材',
        assignee: 'Kasa',
        lastProgress: '2026-09-10',
        reason: '素材來源未定',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [已放棄] 確認 SITCON 照片素材 (Kasa) — 素材來源未定，最後進展 9/10',
    )
  })

  it('should leave out the assignee when nobody owns the action', () => {
    const items: FollowUpItem[] = [
      {
        status: 'stalled',
        description: '徵求線上聚會主持人',
        assignee: null,
        lastProgress: '2026-09-28',
        reason: '無人回應',
      },
    ]

    expect(formatFollowUpItems(items)).toBe(
      '- [停滯] 徵求線上聚會主持人 — 無人回應，最後進展 9/28',
    )
  })
})
