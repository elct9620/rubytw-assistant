import { describe, it, expect } from 'vitest'
import {
  formatFollowUpItems,
  type FollowUpItem,
} from '../../src/entities/follow-up-item'

describe('formatFollowUpItems', () => {
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
