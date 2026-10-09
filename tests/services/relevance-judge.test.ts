import { describe, it, expect } from 'vitest'
import { createRelevanceJudge } from '../../src/services/relevance-judge'
import { scriptedModel } from '../helpers/scripted-model'

const QUESTIONS = [
  {
    description: '詢問場地導流',
    quotes: ['我來問他我們平常用kktix 能不能導過去'],
  },
  { description: '訂購杯套', quotes: ['今天天氣不錯', '大家晚安'] },
]

describe('Relevance Judge', () => {
  it('should ask about every item in one call, numbered with its quotes', async () => {
    const model = scriptedModel([
      JSON.stringify({
        verdicts: [
          { item: 1, relevant: true, reason: '' },
          { item: 2, relevant: true, reason: '' },
        ],
      }),
    ])

    await createRelevanceJudge(model, [])(QUESTIONS)

    expect(model.doGenerateCalls).toHaveLength(1)
    const user = model.doGenerateCalls[0].prompt.find((m) => m.role === 'user')
    expect(JSON.stringify(user?.content)).toContain(
      '1. 詢問場地導流\\n> 我來問他我們平常用kktix 能不能導過去\\n\\n2. 訂購杯套\\n> 今天天氣不錯\\n> 大家晚安',
    )
  })

  it('should answer in the order asked, matching verdicts by item number', async () => {
    const model = scriptedModel([
      JSON.stringify({
        verdicts: [
          {
            item: 2,
            relevant: false,
            reason: 'small talk, not the cup sleeves',
          },
          { item: 1, relevant: true, reason: '' },
        ],
      }),
    ])

    const verdicts = await createRelevanceJudge(model, [])(QUESTIONS)

    expect(verdicts).toEqual([
      { relevant: true, reason: '' },
      { relevant: false, reason: 'small talk, not the cup sleeves' },
    ])
  })

  it('should count an item the model left out as not relevant', async () => {
    const model = scriptedModel([
      JSON.stringify({ verdicts: [{ item: 1, relevant: true, reason: '' }] }),
    ])

    const verdicts = await createRelevanceJudge(model, [])(QUESTIONS)

    expect(verdicts[1]).toEqual({
      relevant: false,
      reason: 'no judgement was returned',
    })
  })
})
