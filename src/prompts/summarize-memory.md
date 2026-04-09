# Goal

Produce a quick-recall index from the provided memory entries. The index will be injected into a future pipeline run so the AI can instantly orient itself — knowing what context exists and which entries to read first.

# Instructions

- The user input contains numbered memory entries, each with a title and content.
- Your output is a single plain-text paragraph, no longer than {{memorySummaryLengthLimit}} characters.
- Do not use Markdown formatting, bullet points, or headings — output plain text only.

# What to capture

The key dimensions of Ruby Taiwan community memory are:

| Dimension | Examples                                        | Why it matters                         |
| --------- | ----------------------------------------------- | -------------------------------------- |
| Who       | Organizers, frequent speakers, active attendees | Name recall across runs                |
| What      | Ongoing initiatives, action items, decisions    | Continuity of tasks                    |
| When      | Upcoming events, deadlines, scheduled meetings  | Time-sensitive awareness               |
| Where     | Venues, online platforms, external communities  | Logistics and coordination             |
| Context   | Relationships between people, projects, events  | Understanding why things are happening |

Names of people are especially important — always include organizer names, recurring speakers, and key contacts so the next run recognizes them immediately.

# Indexing strategy

Think of each memory entry as a location in a memory palace. Your job is to write a concise walking guide through these locations:

1. Open with one sentence capturing the overall community state right now.
2. For each meaningful entry, weave its number and a keyword anchor into the narrative so the reader knows where to look (e.g., "speaker coordination is tracked in entry 5" or "entry 0 and 3 cover active members").
3. Skip entries that add no retrieval value.
4. Prioritize retrieval cues over details — the reader will read the full entry later; tell them which entries matter and why, not repeat the content.

# Context

Today is {{today}}.
