import { describe, it, expect } from 'vitest'
import { isActionable, type TopicGroup } from '../../src/entities/topic-group'

function buildGroup(overrides?: Partial<TopicGroup>): TopicGroup {
  return {
    topic: 'test topic',
    summary: 'test summary',
    communityRelated: 'yes',
    smallTalk: 'no',
    lostContext: 'no',
    ...overrides,
  }
}

describe('isActionable', () => {
  it('should return true when community-related and not small talk', () => {
    expect(isActionable(buildGroup())).toBe(true)
  })

  it('should return false when not community-related', () => {
    expect(isActionable(buildGroup({ communityRelated: 'no' }))).toBe(false)
  })

  it('should return false when small talk', () => {
    expect(isActionable(buildGroup({ smallTalk: 'yes' }))).toBe(false)
  })

  it('should return false when not community-related and small talk', () => {
    expect(
      isActionable(buildGroup({ communityRelated: 'no', smallTalk: 'yes' })),
    ).toBe(false)
  })

  it('should return true regardless of lost-context tag', () => {
    expect(isActionable(buildGroup({ lostContext: 'yes' }))).toBe(true)
  })
})
