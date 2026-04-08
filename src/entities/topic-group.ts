export type AttributeTag = 'yes' | 'no'

export interface TopicGroup {
  topic: string
  summary: string
  communityRelated: AttributeTag
  smallTalk: AttributeTag
  lostContext: AttributeTag
}

export function isActionable(group: TopicGroup): boolean {
  return (
    group.communityRelated === 'yes' &&
    group.smallTalk === 'no' &&
    group.lostContext === 'no'
  )
}
