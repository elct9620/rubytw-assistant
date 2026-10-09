import { describe, it, expect, vi } from 'vitest'
import { generateText, isStepCount } from 'ai'
import { z } from 'zod'
import {
  acceptedSubmission,
  isSubmissionAccepted,
  SUBMIT_TOOL,
} from '../../src/services/submission'
import {
  createEvidenceCheck,
  createSubmitTool,
  EvidenceSchema,
  type Evidence,
  type RelevanceJudge,
  type SubmitResult,
} from '../../src/services/evidence-check'
import type { ChannelMessage, IssueDetail } from '../../src/usecases/ports'
import { createStubDiscordSource, createStubGitHubSource } from './stubs'
import { scriptedModel, type ScriptedCall } from '../helpers/scripted-model'

const ListSchema = z.object({
  items: z.array(
    z.object({
      description: z.string(),
      lastProgress: z.string(),
      evidence: z.array(EvidenceSchema),
    }),
  ),
})

const KASA: ChannelMessage = {
  id: '100',
  text: '場地管理方說可以在他們的平台上宣傳\n我來問他我們平常用kktix 能不能導過去',
  // 22:40 in Taiwan
  timestamp: '2026-10-08T14:40:41.343000+00:00',
  fromSelf: false,
}
const LATE_NIGHT: ChannelMessage = {
  id: '101',
  text: '然後下週來問11月場地',
  // already 2026-10-09 in Taiwan
  timestamp: '2026-10-08T16:30:00.000000+00:00',
  fromSelf: false,
}
const OWN_LIST: ChannelMessage = {
  id: '200',
  text: '- [停滯] 追問 PicCollage 場地',
  timestamp: '2026-10-07T16:02:22.238000+00:00',
  fromSelf: true,
}
const VENUE_ISSUE = {
  number: 93,
  updatedAt: '2026-10-09T02:00:00Z',
} as IssueDetail

const fromKasa: Evidence = {
  type: 'message',
  id: '100',
  quote: '我來問他我們平常用kktix 能不能導過去',
}

const allRelevant: RelevanceJudge = async (questions) =>
  questions.map(() => ({ relevant: true, reason: '' }))

function sources(
  messages: ChannelMessage[] = [KASA, LATE_NIGHT, OWN_LIST],
  issues: IssueDetail[] = [VENUE_ISSUE],
) {
  return {
    judge: vi.fn(allRelevant),
    discord: createStubDiscordSource({
      readMessage: vi.fn(
        async (id: string) => messages.find((m) => m.id === id) ?? null,
      ),
    }),
    github: createStubGitHubSource({
      readIssues: vi.fn(async (numbers: number[]) =>
        issues.filter((issue) => numbers.includes(issue.number)),
      ),
    }),
  }
}

const item = (evidence: Evidence[], lastProgress = '2026-10-08') => ({
  description: '詢問場地導流',
  lastProgress,
  evidence,
})

const submit = (...items: ReturnType<typeof item>[]): ScriptedCall => ({
  toolName: SUBMIT_TOOL,
  input: { items },
})

function runFollowUp(turns: ScriptedCall[][], deps = sources()) {
  return generateText({
    model: scriptedModel(turns, 100),
    prompt: 'follow up',
    tools: {
      [SUBMIT_TOOL]: createSubmitTool(ListSchema, createEvidenceCheck(deps)),
    },
    stopWhen: [isSubmissionAccepted, isStepCount(10)],
  })
}

const submitResults = (result: Awaited<ReturnType<typeof runFollowUp>>) =>
  result.steps.flatMap((step) =>
    step.toolResults
      .filter((r) => r.toolName === SUBMIT_TOOL)
      .map((r) => r.output as SubmitResult),
  )

async function firstResult(...items: ReturnType<typeof item>[]) {
  return submitResults(await runFollowUp([[submit(...items)]]))[0]
}

describe('Evidence Check', () => {
  it('should accept an item quoting a member verbatim, dated by its newest evidence', async () => {
    const result = await runFollowUp([[submit(item([fromKasa]))]])

    expect(submitResults(result)).toEqual([{ accepted: true }])
    expect(acceptedSubmission(result.steps)).toEqual({
      items: [item([fromKasa])],
    })
  })

  it('should accept an empty list', async () => {
    expect(await firstResult()).toEqual({ accepted: true })
  })

  it('should refuse an item that cites no evidence', async () => {
    expect(await firstResult(item([]))).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/Exists: it cites no evidence/)],
    })
  })

  it('should refuse a message that is not in the channel', async () => {
    const missing: Evidence = { type: 'message', id: '999', quote: '場地' }

    expect(await firstResult(item([missing]))).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/Exists: message 999 is not in/)],
    })
  })

  it('should refuse an Issue that does not exist', async () => {
    expect(await firstResult(item([{ type: 'issue', number: 404 }]))).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/Exists: Issue #404 does not exist/)],
    })
  })

  it("should refuse the assistant's own list as evidence", async () => {
    const own: Evidence = { type: 'message', id: '200', quote: '追問' }

    expect(await firstResult(item([own], '2026-10-08'))).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/Not self/)],
    })
  })

  it('should refuse a quote the message does not contain', async () => {
    const paraphrase: Evidence = { ...fromKasa, quote: 'Kasa 會問場地方' }

    expect(await firstResult(item([paraphrase]))).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/Quoted/)],
    })
  })

  it('should read a quote copied from the XML it was shown as plain text', async () => {
    const deps = sources([{ ...KASA, text: 'Q&A <RubyJam>' }])
    const escaped: Evidence = { ...fromKasa, quote: 'Q&amp;A &lt;RubyJam&gt;' }

    const result = await runFollowUp([[submit(item([escaped]))]], deps)

    expect(submitResults(result)[0]).toEqual({ accepted: true })
  })

  it('should refuse a last progress that is not the Taiwan date of the newest evidence', async () => {
    const lateNight: Evidence = {
      type: 'message',
      id: '101',
      quote: '11月場地',
    }

    expect(await firstResult(item([lateNight], '2026-10-08'))).toEqual({
      accepted: false,
      failures: [
        expect.stringMatching(/Dated: last progress must be 2026-10-09/),
      ],
    })
  })

  it('should date an item by its newest evidence, message or Issue', async () => {
    const result = await firstResult(
      item([fromKasa, { type: 'issue', number: 93 }], '2026-10-09'),
    )

    expect(result).toEqual({ accepted: true })
  })

  it('should let the agent fix a refused list and read each cited message once', async () => {
    const deps = sources()
    const wrongDate = item([fromKasa], '2026-10-01')

    const result = await runFollowUp(
      [[submit(wrongDate)], [submit(item([fromKasa]))]],
      deps,
    )

    expect(submitResults(result).map((r) => r.accepted)).toEqual([false, true])
    expect(deps.discord.readMessage).toHaveBeenCalledTimes(1)
  })

  it('should refuse evidence Discord could not serve, and read it again on the next submission', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = sources()
    vi.mocked(deps.discord.readMessage).mockRejectedValueOnce(
      new Error('Discord API error: 503'),
    )

    const result = await runFollowUp(
      [[submit(item([fromKasa]))], [submit(item([fromKasa]))]],
      deps,
    )

    const [refused, accepted] = submitResults(result)
    expect(refused).toEqual({
      accepted: false,
      failures: [expect.stringMatching(/could not be read now/)],
    })
    expect(accepted).toEqual({ accepted: true })
  })

  it('should read Issues in batches the GitHub source accepts', async () => {
    const issues = Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      updatedAt: '2026-10-09T02:00:00Z',
    })) as IssueDetail[]
    const deps = sources([], issues)
    const cited = item(
      issues.map((issue) => ({ type: 'issue', number: issue.number })),
      '2026-10-09',
    )

    const result = await runFollowUp([[submit(cited)]], deps)

    expect(submitResults(result)[0]).toEqual({ accepted: true })
    expect(
      vi.mocked(deps.github.readIssues).mock.calls.map(([n]) => n.length),
    ).toEqual([10, 1])
  })

  it('should refuse an item whose quotes the judge finds are about something else', async () => {
    const deps = sources()
    deps.judge.mockResolvedValueOnce([
      { relevant: false, reason: 'the quote is about KKTIX, not the venue' },
    ])

    const result = await runFollowUp([[submit(item([fromKasa]))]], deps)

    expect(submitResults(result)[0]).toEqual({
      accepted: false,
      failures: [
        '"詢問場地導流" — Relevant: the quote is about KKTIX, not the venue',
      ],
    })
  })

  it('should ask the judge only about items whose evidence holds up and that quote messages', async () => {
    const deps = sources()
    const issueOnly = {
      ...item([{ type: 'issue', number: 93 }], '2026-10-09'),
      description: '預約場地',
    }
    const misdated = {
      ...item([fromKasa], '2026-10-01'),
      description: '補上日期',
    }

    await runFollowUp([[submit(item([fromKasa]), issueOnly, misdated)]], deps)

    expect(deps.judge).toHaveBeenCalledWith([
      { description: '詢問場地導流', quotes: [fromKasa.quote] },
    ])
  })

  it('should refuse items the judge could not judge, and judge them again on the next submission', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = sources()
    deps.judge.mockRejectedValueOnce(new Error('AI Gateway timeout'))

    const result = await runFollowUp(
      [[submit(item([fromKasa]))], [submit(item([fromKasa]))]],
      deps,
    )

    const [refused, accepted] = submitResults(result)
    expect(refused).toEqual({
      accepted: false,
      failures: ['"詢問場地導流" — Relevant: could not be judged now'],
    })
    expect(accepted).toEqual({ accepted: true })
  })
})
