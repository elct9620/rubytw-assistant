import { tool } from 'ai'
import type { StepResult, StopCondition, ToolSet } from 'ai'
import { z } from 'zod'
import type {
  ChannelMessage,
  DiscordSource,
  GitHubSource,
  IssueDetail,
} from '../usecases/ports'
import { taiwanDate } from '../entities/taiwan-date'

const READ_ISSUES_MAX = 10
const XML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
}

export const EvidenceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    id: z.string().describe('the id of a message in the channel'),
    quote: z
      .string()
      .trim()
      .min(1)
      .describe('text copied verbatim from that message'),
  }),
  z.object({
    type: z.literal('issue'),
    number: z.number().int().positive(),
  }),
])
export type Evidence = z.infer<typeof EvidenceSchema>

export interface EvidencedItem {
  description: string
  lastProgress: string
  evidence: Evidence[]
}

export type SubmitResult =
  { accepted: true } | { accepted: false; failures: string[] }

/** An item the Relevant check asks about: its next action and what it quotes. */
export interface RelevanceQuestion {
  description: string
  quotes: string[]
}

/** Whether each item's quotes are about it, in the order asked, with why not. */
export type RelevanceJudge = (
  questions: RelevanceQuestion[],
) => Promise<{ relevant: boolean; reason: string }[]>

export interface EvidenceSources {
  discord: Pick<DiscordSource, 'readMessage'>
  github: Pick<GitHubSource, 'readIssues'>
  judge: RelevanceJudge
}

/** Each failure names the item and the check it failed; an empty list accepts. */
export type EvidenceCheck = (items: EvidencedItem[]) => Promise<string[]>

type Lookup<T> = T | null | 'unreadable'

/** The model quotes the XML it was shown, so entities it copied are read back as text. */
const unescapeXml = (text: string) =>
  text.replace(/&(lt|gt|quot|amp);/g, (entity) => XML_ENTITIES[entity])

/**
 * Builds the Evidence Check for one run. Cited messages and Issues are read
 * once per run, however many submissions cite them.
 */
export function createEvidenceCheck({
  discord,
  github,
  judge,
}: EvidenceSources): EvidenceCheck {
  const messages = new Map<string, ChannelMessage | null>()
  const issues = new Map<number, IssueDetail | null>()

  async function readMessage(id: string): Promise<Lookup<ChannelMessage>> {
    if (messages.has(id)) return messages.get(id) ?? null
    try {
      const message = await discord.readMessage(id)
      messages.set(id, message)
      return message
    } catch (error) {
      console.warn(`Evidence Check could not read message ${id}:`, error)
      return 'unreadable'
    }
  }

  /** An Issue that could not be read is left out of the cache, so a later submission retries it. */
  async function readIssues(numbers: number[]): Promise<void> {
    const unread = [...new Set(numbers)].filter((n) => !issues.has(n))
    for (let i = 0; i < unread.length; i += READ_ISSUES_MAX) {
      const batch = unread.slice(i, i + READ_ISSUES_MAX)
      try {
        const found = await github.readIssues(batch, 0)
        for (const n of batch) {
          issues.set(n, found.find((issue) => issue.number === n) ?? null)
        }
      } catch (error) {
        console.warn(`Evidence Check could not read Issues ${batch}:`, error)
      }
    }
  }

  /** The time one piece of evidence was last moved, or the check it fails and why. */
  async function verdictOf(
    evidence: Evidence,
  ): Promise<{ time: string } | { check: string; detail: string }> {
    if (evidence.type === 'issue') {
      const issue = issues.get(evidence.number)
      if (issue === undefined) {
        return {
          check: 'Exists',
          detail: `Issue #${evidence.number} could not be read now`,
        }
      }
      if (issue === null) {
        return {
          check: 'Exists',
          detail: `Issue #${evidence.number} does not exist`,
        }
      }
      return { time: issue.updatedAt }
    }

    const message = await readMessage(evidence.id)
    if (message === 'unreadable') {
      return {
        check: 'Exists',
        detail: `message ${evidence.id} could not be read now`,
      }
    }
    if (message === null) {
      return {
        check: 'Exists',
        detail: `message ${evidence.id} is not in the channel`,
      }
    }
    if (message.fromSelf) {
      return {
        check: 'Not self',
        detail: `message ${evidence.id} is the assistant's own; cite what people wrote`,
      }
    }
    if (!message.text.includes(unescapeXml(evidence.quote))) {
      return {
        check: 'Quoted',
        detail: `"${evidence.quote}" is not in message ${evidence.id}; copy its text verbatim`,
      }
    }
    return { time: message.timestamp }
  }

  async function checkItem(item: EvidencedItem): Promise<string[]> {
    const failed = (check: string, detail: string) =>
      `"${item.description}" — ${check}: ${detail}`
    if (item.evidence.length === 0) {
      return [failed('Exists', 'it cites no evidence')]
    }

    const failures: string[] = []
    const times: string[] = []
    for (const evidence of item.evidence) {
      const verdict = await verdictOf(evidence)
      if ('time' in verdict) times.push(verdict.time)
      else failures.push(failed(verdict.check, verdict.detail))
    }

    if (failures.length === 0) {
      const newest = times.reduce((a, b) =>
        Date.parse(a) >= Date.parse(b) ? a : b,
      )
      const date = taiwanDate(new Date(newest))
      if (item.lastProgress !== date) {
        failures.push(
          failed(
            'Dated',
            `last progress must be ${date}, the date of its newest evidence`,
          ),
        )
      }
    }
    return failures
  }

  /** Judged only for items whose evidence holds up, so one judgement covers the list. */
  async function checkRelevance(items: EvidencedItem[]): Promise<string[]> {
    const questions = items
      .map((item) => ({
        description: item.description,
        quotes: item.evidence.flatMap((e) =>
          e.type === 'message' ? [e.quote] : [],
        ),
      }))
      .filter((question) => question.quotes.length > 0)
    if (questions.length === 0) return []

    let verdicts: Awaited<ReturnType<RelevanceJudge>>
    try {
      verdicts = await judge(questions)
    } catch (error) {
      console.warn('Evidence Check could not judge relevance:', error)
      return questions.map(
        (q) => `"${q.description}" — Relevant: could not be judged now`,
      )
    }
    return questions.flatMap((q, i) => {
      const verdict = verdicts[i]
      return verdict.relevant
        ? []
        : [`"${q.description}" — Relevant: ${verdict.reason}`]
    })
  }

  return async (items) => {
    const cited = items.flatMap((item) =>
      item.evidence.flatMap((e) => (e.type === 'issue' ? [e.number] : [])),
    )
    await readIssues(cited)
    const results = await Promise.all(items.map(checkItem))
    const grounded = items.filter((_, i) => results[i].length === 0)
    return [...results.flat(), ...(await checkRelevance(grounded))]
  }
}

/** Hands in the list; it is accepted only once every item passes the Evidence Check. */
export function createSubmitTool<
  S extends z.ZodType<{ items: EvidencedItem[] }>,
>(schema: S, check: EvidenceCheck) {
  return tool({
    description:
      'Hand in the follow-up list. Each item must cite its evidence: messages people wrote (with text copied verbatim) or Issues, and its last progress must be the date of its newest evidence. A list with a failing item is refused with what failed; fix or drop those items, then submit again.',
    inputSchema: schema,
    execute: async (input): Promise<SubmitResult> => {
      const failures = await check(input.items)
      return failures.length === 0
        ? { accepted: true }
        : { accepted: false, failures }
    },
  })
}

export function tokensSpent<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[],
): number {
  return steps.reduce(
    (total, step) =>
      total +
      (step.usage.totalTokens ??
        (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0)),
    0,
  )
}

export function isOverTokenBudget(budget: number): StopCondition<ToolSet> {
  return ({ steps }) => tokensSpent(steps) > budget
}
