# Ruby Taiwan Assistant

## Purpose

Provide automated information aggregation and query tools for Ruby Taiwan community operators, reducing the burden of manually tracking GitHub project progress and Discord community discussions.

## Users

| User               | Role                         | Goal                                                                                            |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Community Operator | Ruby Taiwan core team member | Stay informed on community activity, track project progress, respond to community needs quickly |

## Impacts

| Behavior Change    | Current State                                                                | Target State                                                                 |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Progress Follow-up | Operators manually browse GitHub and Discord to recall what is still pending | System pushes a daily list of unfinished items, each with when it last moved |
| Data Querying      | Operators switch to GitHub UI to search Issues or Project status             | _(Deferred)_ Query directly in Discord via commands                          |
| Memory Correction  | Wrong or stale memory can only be displaced by a later daily run             | Operators inspect and correct memory directly through an MCP client          |

## Success Criteria

- After each scheduled trigger, the designated Discord channel receives an AI-generated list of what is still unfinished; an item that is done no longer appears
- Each daily run stays within the Follow-up Token Budget
- An operator holding the designated Discord role can connect an MCP client and correct memory without waiting for a daily run
- A Discord account without that role is refused, and an account that loses it stops being served within one hour
- _(Deferred — see Feature 2)_ Operators can query Issue status and project progress in Discord and get immediate responses

## Non-goals

- Does not create or modify Discord roles, permissions, or memberships; role membership is read to decide access
- Does not provide GitHub Issue creation or modification (read-only access)
- Does not provide features for general community members (operators only)

## Features

### 1. Daily Follow-up

The system collects discussion messages from a designated Discord channel over a configurable time window (default: 24 hours) on a schedule, has the Follow-up Agent work out what is still unfinished, and sends that list to the same Discord channel. The Memory Agent then tidies memory and condenses it for the next run.

The list reminds operators of what has not moved, rather than restating what was discussed. An item stays on it until people finish it; an item that is done leaves the list.

**Processing:**

| Stage           | Input                                                   | Output                                                                                       |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Data Collection | Discord channel message history                         | Time-sorted message list (with author, content, timestamp, attachments, mentions)            |
| Follow-up Agent | Sorted message list + stored Memory Summary (if exists) | Follow-up list: every unfinished item, each with status, assignee, last progress, and reason |
| Memory Agent    | All memory slots (after the Follow-up Agent's updates)  | Tidied memory slots, and a condensed Memory Summary (≤ Memory Summary Length Limit)          |

**AI Available Tools:**

| Tool         | Capability                                                                                  | Available To                  | Purpose                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Memory Tool  | Read and write index-based context memory (see Memory Tool Interface below)                 | Follow-up Agent, Memory Agent | Track unfinished items and lasting knowledge across executions              |
| GitHub Tool  | List, search, and read Issues (see GitHub Tool Query below)                                 | Follow-up Agent               | Verify task status, relate conversations to existing issues                 |
| Discord Tool | Read and search the designated channel's messages in bounded pages (see Discord Tool Query) | Follow-up Agent               | Find when people last discussed an item; recover context outside the window |
| Submit       | Hand in the follow-up list (see Goal Check below)                                           | Follow-up Agent               | End the run once the Goal Check accepts the work                            |

**User Journey:**

| Context                          | Action                                            | Outcome                                                                                 |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Operator starts their daily work | System has already sent the follow-up list        | Operator sees which items are unfinished, who holds them, and how long since they moved |
| An operator finishes an item     | People say so in the channel, or the Issue closes | The next list no longer shows the item                                                  |

### 2. Discord Interaction Commands (Deferred)

Operators issue query commands via Slash Commands in Discord. The system retrieves data through the GitHub App and responds. This feature is awaiting design and no part of it is in the current implementation scope; both the Discord Interaction Webhook handling and the command behaviors will be defined in a future specification iteration.

### 3. GitHub App Integration

The system is installed as a GitHub App on the Ruby Taiwan organization with read-only permissions to access Project and Issues data, serving as the data source for the daily follow-up and interaction commands.

**User Journey:**

| Context                            | Action                                           | Outcome                                 |
| ---------------------------------- | ------------------------------------------------ | --------------------------------------- |
| System needs to access GitHub data | Authenticate via GitHub App and send API request | Retrieve latest Project and Issues data |

### 4. Debug Summary Preview

A development-only HTTP endpoint that runs the same daily follow-up as Feature 1, but returns the result directly in the HTTP response instead of sending it to a Discord channel. This allows operators to inspect and verify the follow-up list without polluting any channel.

**Constraints:**

| Aspect          | Decision                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Availability    | Development environment only; the endpoint does not exist in production                                                         |
| Network origin  | Only requests from localhost are accepted; non-local requests are rejected even if the endpoint happens to be mounted           |
| Authentication  | None; environment isolation and localhost restriction are the sole access control mechanisms                                    |
| Result delivery | HTTP response body containing the follow-up list as structured data; no Discord message sent                                    |
| Side effects    | Both agents write memory slots and the Memory Agent writes the Memory Summary; the next production run reads what this run left |
| Prerequisites   | Development environment must have access to the same Discord Bot Token and AI Service as production                             |

**Parameters:**

| Parameter         | Description                              | Required                                                |
| ----------------- | ---------------------------------------- | ------------------------------------------------------- |
| Source Channel ID | Discord channel to collect messages from | Yes                                                     |
| Hours             | Time window for message collection       | No (defaults to Summary Collection Hours configuration) |

**User Journey:**

| Context                                                          | Action                                                       | Outcome                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Operator is tuning follow-up behavior and wants to verify output | Send HTTP request to debug endpoint with a source channel ID | Operator receives the follow-up list in the response and can inspect correctness |

### 5. MCP Management Endpoint

An MCP endpoint carries the assistant's own data to operators between daily runs. Memory slots and the Memory Summary are readable and writable through named tools; several slots may be corrected in one call. Reading Project Issues through this endpoint is deferred and no tool exposes them in the current scope.

An issued access token is honoured for one hour before the Operator Role is re-read (fixed design constraint, not configurable). This bounds how long a revoked operator keeps access.

Access is decided by Discord. The visitor establishes identity through Discord's authorization, and the assistant serves only accounts holding the Operator Role in the designated guild. Deciding access costs the visitor no consent beyond revealing their identity — role membership is read with the assistant's own credential, not theirs.

**User Journey:**

| Context                                                             | Action                                                            | Outcome                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Operator wants to correct memory an AI run recorded wrongly         | Connect an MCP client to the endpoint and sign in through Discord | Operator is asked to confirm which client is asking, then the client is served |
| A Discord account without the Operator Role attempts to connect     | Sign in through Discord                                           | Access is refused and no grant is created                                      |
| An operator's role is removed after their client was already served | Client continues using its existing access                        | Access ends within one hour, without anyone revoking the client by hand        |

## Configuration

| Setting                         | Description                                                                                                 | Default                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Discord Channel ID              | Designated channel for summary delivery and message collection                                              | (required, no default) |
| Summary Collection Hours        | Collect Discord messages from the past N hours; also how far back `read_messages` looks when given no start | 24                     |
| Summary Item Limit              | Maximum number of items in one follow-up list                                                               | 30                     |
| Memory Entry Limit              | Maximum number of memory slots for Memory Tool                                                              | 32                     |
| Memory Description Limit        | Maximum character length for memory slot description                                                        | 128                    |
| Memory Summary Length Limit     | Maximum character length for the Memory Summary, whether generated or operator-written                      | 300                    |
| Follow-up Token Budget          | Maximum tokens (input and output together) one Follow-up Agent run may spend                                | 400000                 |
| AI Gateway                      | Gateway every AI request passes through; each request is tagged with metadata naming this assistant         | `rubytw`               |
| Issue Body Length Limit         | Maximum character length for an Issue body, and for each comment, in read_issues result                     | 500                    |
| Discord Guild ID                | Guild whose role membership decides MCP endpoint access                                                     | (required, no default) |
| Operator Role ID                | Role within that guild that grants MCP endpoint access                                                      | (required, no default) |
| Discord Application Credentials | Client ID and secret identifying the assistant to Discord's authorization service                           | (required, no default) |

## System Boundary

| Aspect         | Inside System                                                                                                                                                                                                                                         | Outside System                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Responsibility | Data collection, daily follow-up generation, memory management, memory summary generation, query responses, deciding who may reach the MCP endpoint                                                                                                   | Discord server administration, GitHub project management, deciding who holds the Operator Role                         |
| Interaction    | Receive Discord Interaction Webhook; call GitHub API and AI service; read and search channel message history; read/write persistent memory store; read/write Memory Summary Store; read guild role membership; issue and revalidate MCP access tokens | Authenticating the person behind a Discord account; GitHub permission settings; Discord channel and role configuration |
| Control        | Summary schedule and content format; channel and collection hours configuration; memory entry limit; which guild and role grant MCP access                                                                                                            | Discord channel and role configuration; GitHub Project structure                                                       |

## Behaviors

### Daily Follow-up

#### Data Collection

| State                               | Action                                                                  | Result                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Scheduled time reached              | Trigger the daily follow-up run                                         | System begins collecting data                                                          |
| Discord message history collected   | Retrieve messages from designated channel within configured time window | Messages ordered oldest first, each in the Message Format (see Discord Tool Query)     |
| Window holds more than 500 messages | Keep the earliest 500 (fixed design constraint, not configurable)       | The run works with the earliest 500; later messages in the window are left out         |
| Window holds no messages            | Skip both agents                                                        | A plain text notice is sent instead (see Error Scenarios); memory is left as it stands |

#### Memory Summary Injection

| State                    | Action                                                          | Result                                                                 |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Data collection complete | Read stored Memory Summary from Memory Summary Store            | Previously generated summary retrieved                                 |
| No stored summary exists | Skip injection                                                  | The Follow-up Agent's instructions contain no memory context paragraph |
| Stored summary exists    | Append summary to the end of the Follow-up Agent's instructions | The Follow-up Agent begins with historical context awareness           |

#### Follow-up Agent

A single agent run takes the collected messages and produces the follow-up list. It maintains the memory slots that track unfinished items itself, and decides on its own how to correct an item when the conversation contradicts what memory holds.

| State                                                     | Action                                                                                                         | Result                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Run starts                                                | AI reads memory for the items it is tracking                                                                   | Unfinished items from earlier runs are carried into this run                                                    |
| Messages contain the assistant's own earlier lists        | AI treats them as what the assistant concluded, not as new evidence about an item                              | An item does not count as moved because the assistant repeated it                                               |
| A tracked item is carried forward                         | AI looks through Discord Tool for when people last discussed it, and for replies to the assistant's lists      | The item is judged against what people last said about it; a reply that corrects a list updates the item        |
| Messages or memory reference an Issue                     | AI checks the Issue through GitHub Tool                                                                        | The item's status reflects the Issue's state                                                                    |
| People commit to something in the collected messages      | AI adds it as a tracked item in this run                                                                       | The new item appears on this run's list                                                                         |
| An item is found finished                                 | AI leaves it off the list and updates or clears its memory slot                                                | A finished item never appears on the list                                                                       |
| AI records a tracked item                                 | Write the slot with today's date and the item's current state                                                  | A later run can tell how long the item has gone without moving                                                  |
| AI hands in the list through Submit                       | Apply the Goal Check                                                                                           | Accepted: the run ends with the list. Refused: AI is told which checks are unmet and why, and continues the run |
| Tokens spent by the run exceed the Follow-up Token Budget | Stop the run                                                                                                   | The run fails (see Error Scenarios)                                                                             |
| AI stops without a list the Goal Check accepted           | End the run                                                                                                    | The run fails (see Error Scenarios)                                                                             |
| List accepted                                             | Compile into the follow-up list (capped by Summary Item Limit), one line per item (see Follow-up Item Display) | Plain text message sent to designated Discord channel for operators to read                                     |
| List accepted with no items                               | Send a plain text notice that nothing is pending                                                               | Operators know the run completed and found nothing unfinished                                                   |

**Goal Check** (fixed design constraint). Each check is judged from the tool calls made earlier in the same run; the content of the list is not judged.

| Check           | Accepted When                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Memory checked  | `list_memories` and `read_memories` were both called                                                                                                                     |
| History checked | `search_messages` was called with `author` as `people` at least once                                                                                                     |
| Issues checked  | A collected message references an Issue by `#` followed by its number, and a GitHub Tool operation was called; a run whose messages reference no Issue passes this check |

**Follow-up Item:**

| Field         | Content                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Status        | to-do, in-progress, or stalled                                                                           |
| Description   | What remains to be done                                                                                  |
| Assignee      | Person name exactly as it appears in conversation, or none when unassigned                               |
| Last Progress | Date people last moved the item (discussed it, or its Issue changed), or none when no movement was found |
| Reason        | Why the item has this status                                                                             |

**Follow-up Item Display:** `- [狀態] Description (Assignee) — 最後進展 YYYY-MM-DD — Reason`. The assignee part is omitted when there is none; the last-progress part reads `尚無進展紀錄` when there is none.

| Status      | Display Text |
| ----------- | ------------ |
| to-do       | `[待辦]`     |
| in-progress | `[進行中]`   |
| stalled     | `[停滯]`     |

#### Memory Agent

The Memory Agent runs once the Follow-up Agent has succeeded. It has the Memory Tool only, tidies the slots, and condenses them into the Memory Summary.

| State                                                                                     | Action                                                                    | Result                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Follow-up Agent succeeded                                                                 | Run the Memory Agent                                                      | Memory is tidied before the next run reads it                         |
| Follow-up Agent failed                                                                    | Skip the Memory Agent                                                     | Memory and the stored Memory Summary stay as the failed run left them |
| A slot records a finished or closed item                                                  | Clear the slot                                                            | Finished work no longer occupies memory                               |
| A slot's latest recorded date is more than 14 days before today (fixed design constraint) | Clear the slot, unless it holds lasting knowledge                         | Items nobody has moved for two weeks leave memory                     |
| A slot holds lasting knowledge (people, community members, standing facts)                | Keep it; rewrite it when a newer slot holds a fresher version             | Lasting knowledge is updated, never cleared for age                   |
| Several slots track the same item                                                         | Merge them into one slot and clear the others                             | Each item occupies one slot                                           |
| All slots empty after tidying                                                             | Skip summary generation                                                   | Memory Summary Store not updated; next run has no injected context    |
| Non-empty slots remain                                                                    | Condense them into a plain-text paragraph (≤ Memory Summary Length Limit) | Summary written to Memory Summary Store for the next run              |

### MCP Management Endpoint

#### Access Authorization

Every request to the MCP endpoint carries an access token the assistant issued. A token is issued only after a Discord account has proved its identity, been found to hold the Operator Role, and confirmed which client is asking.

| State                                                   | Action                                                                                  | Result                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| MCP client requests authorization                       | Redirect the visitor to Discord's authorization, requesting identity only               | Visitor authenticates with Discord; the assistant learns their account, nothing more |
| Visitor returns from Discord                            | Read their role membership in the configured guild using the assistant's bot credential | Membership is known without the visitor granting any guild-related consent           |
| Visitor holds the Operator Role                         | Present the requesting client by name and ask the visitor to confirm                    | Visitor sees which client is asking before any grant exists                          |
| Requesting client registered no name                    | Present it as unnamed and ask the visitor to confirm                                    | Visitor is told the client did not identify itself rather than shown a blank         |
| Visitor confirms                                        | Create the grant and return the client to its redirect target                           | Client completes the exchange and holds an access token                              |
| Visitor does not hold the Operator Role                 | Refuse and create no grant                                                              | Client receives no token; nothing about the visitor is retained                      |
| Request to the MCP endpoint carries no or unknown token | Reject the request                                                                      | Client is told to authorize first                                                    |

#### Access Revalidation

| State                                     | Action                                | Result                                                    |
| ----------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| Client refreshes its access token         | Re-read the account's role membership | Role is confirmed still held before a new token is issued |
| Account no longer holds the Operator Role | Refuse the refresh                    | Access ends within one hour; no manual revocation needed  |

#### Memory Management Tools

An authorized operator reaches the assistant's memory through five tools. An update carries no read-before-write condition; any slot may be written directly.

| State                                                                                               | Action                                                            | Result                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Operator invokes `list_memories`                                                                    | Return index and description for every slot                       | Operator receives all slots with index and description; an unused slot has an empty string as description        |
| Operator invokes `read_memories(idx[])`                                                             | Return full content for each requested slot index                 | Operator receives content for the specified slots; a repeated index yields one entry                             |
| Operator invokes `update_memories`                                                                  | Write the given slots, each addressed by its index                | Every named slot is created or overwritten; the number of slots in one call does not affect whether it is served |
| Operator writes empty content for a slot                                                            | `update_memories` receives an empty string as that slot's content | That slot is cleared (description and content become empty string)                                               |
| A slot names an index outside the slot range, or a description longer than Memory Description Limit | Refuse the whole call                                             | No slot changes; the operator is told which constraint was broken                                                |
| Operator invokes `read_memory_summary`                                                              | Return the stored Memory Summary                                  | Operator receives the summary, or is told none is stored                                                         |
| Operator invokes `write_memory_summary`                                                             | Replace the stored Memory Summary                                 | The next daily run injects the operator's text in place of the last generated summary                            |
| Summary exceeds Memory Summary Length Limit                                                         | Refuse the write                                                  | The stored summary is unchanged and the operator is told the limit                                               |

### Debug Summary Preview

| State                                                  | Action                                                     | Result                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Debug endpoint receives request with source channel ID | Collect messages from specified channel within time window | Messages retrieved using same data collection logic as Daily AI Summary                          |
| Messages collected                                     | Run the Follow-up Agent, then the Memory Agent             | Same behavior as Daily Follow-up; follow-up list produced, memory tidied, Memory Summary updated |
| Follow-up list accepted                                | Return the follow-up list in HTTP response                 | Response contains the follow-up items as structured data; no Discord message sent                |
| No messages found in time window                       | Skip both agents                                           | Return empty result indicating no messages found                                                 |

### GitHub App Integration

| State                     | Action                                                  | Result                             |
| ------------------------- | ------------------------------------------------------- | ---------------------------------- |
| GitHub data access needed | Use App credentials to obtain Installation Access Token | Obtain time-limited access token   |
| Access Token valid        | Send GitHub API request                                 | Retrieve requested data            |
| Access Token expired      | Re-obtain Installation Access Token                     | Retry request with refreshed token |

### GitHub Tool Query

GitHub Tool provides three operations: `list_issues` returns an overview of the Issues on the Project board; `search_issues` finds Issues in the configured repository by keyword, whether or not they are on the board; `read_issues` returns full details, including body and recent comments, for Issues the AI has already identified by number.

#### List Issues

| State                             | Action                                                                         | Result                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| AI invokes `list_issues`          | Query Project V2 items; filter to Issues only (exclude PRs, DraftIssues)       | Return Issue list with: title, number, state, url, labels, assignees, project status field |
| AI specifies state filter         | Apply state filter (OPEN or CLOSED) to Issue list                              | Return only Issues matching the specified state                                            |
| AI omits the state filter         | Return all Issues regardless of state                                          | AI determines relevance based on state and project status fields in the returned data      |
| Project has more items than limit | Return at most 50 Issues per query (fixed design constraint, not configurable) | AI works with available data; may miss items beyond the limit                              |

#### Search Issues

| State                                     | Action                                                                                                      | Result                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI invokes `search_issues` with a query   | Search the configured repository for Issues matching the query; Pull Requests are excluded                  | Return Issue list with the same fields as `list_issues`; project status field is empty for an Issue that is not on the Project |
| Query uses GitHub issue search qualifiers | Pass them through; the repository and Issue-only restrictions always apply                                  | AI may narrow by label, state, or assignee within the configured repository only                                               |
| More Issues match than the limit          | Return at most 20 Issues per query, in GitHub's relevance order (fixed design constraint, not configurable) | AI works with the best matches; may miss lower-ranked ones                                                                     |
| Query is empty                            | Reject the call before searching                                                                            | AI is told a query is required                                                                                                 |

#### Read Issues

| State                                                   | Action                                                                          | Result                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| AI invokes `read_issues` with number list               | Fetch each specified Issue's details                                            | Return Issue details with: title, number, state, url, labels, assignees, project status field, last-updated time, body, recent comments |
| Issue has comments                                      | Include the 5 most recent, oldest of those first (fixed design constraint)      | Each comment carries its author, creation time, and body; earlier comments are not returned                                             |
| Issue body or a comment exceeds Issue Body Length Limit | Truncate that text to the configured character limit                            | AI receives the leading portion up to the limit; trailing content is not returned                                                       |
| Input contains more numbers than limit                  | Accept at most 10 Issue numbers per call (fixed design constraint)              | Request with more than 10 numbers is rejected before fetching                                                                           |
| Requested number is missing or inaccessible             | Skip that number (does not exist, not an Issue, or outside the Project's scope) | Result omits the skipped number; remaining Issues returned normally                                                                     |

### Discord Tool Query

Discord Tool provides two operations over the designated channel: `read_messages` returns every message in a time range in order, a bounded page per call; `search_messages` returns the messages that match a condition. Each call returns a bounded page and the AI decides whether to ask for more. A continuation cursor continues the call that issued it: the AI repeats that call's other arguments and adds the cursor. Times in tool input are ISO 8601 timestamps; a call carrying any other time value is rejected. The assistant recognises its own account by the Discord Application's Client ID.

#### Message Format

Every message the system hands to the AI, whether collected for the daily run or returned by a Discord Tool operation, carries the same fields. A message with no text content is not returned.

| Field        | Content                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message      | Message id                                                                                                                                                                                                                                                                              |
| Author       | Member id, display name, whether the author is a bot, whether the author is the assistant itself                                                                                                                                                                                        |
| Timestamp    | When the message was sent                                                                                                                                                                                                                                                               |
| Content      | Message text                                                                                                                                                                                                                                                                            |
| Attachments  | Filename and URL of each attachment; absent when the message has none                                                                                                                                                                                                                   |
| Mentions     | Member id and display name of each mentioned member, and whether that member is the assistant itself; absent when the message mentions nobody                                                                                                                                           |
| Reply target | Present on a reply: id of the message replied to, display name of its author, whether that author is the assistant itself; the replied-to text is not included. Only the id is carried when the replied-to message no longer exists, and on every message returned by `search_messages` |

#### Read Messages

| State                             | Action                                                                    | Result                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| AI invokes `read_messages`        | Return messages sent at or after `since` and before `until`, oldest first | Result carries the messages, their count, and a continuation cursor         |
| AI omits `since`                  | Start Summary Collection Hours before now                                 | The default range is the window the daily run collects                      |
| AI omits `until`                  | End at now                                                                | Range runs to the present                                                   |
| AI omits `limit`                  | Return at most 50 messages                                                | One call stays within a bounded page                                        |
| `limit` is below 1 or above 100   | Reject the call                                                           | AI is told the accepted range                                               |
| `since` is later than `until`     | Reject the call                                                           | AI is told the range is empty                                               |
| More messages remain in the range | Return a continuation cursor                                              | Passing it as `cursor` with the same range returns the messages that follow |
| Range is exhausted                | Return no continuation cursor                                             | AI knows it has read the whole range                                        |

#### Search Messages

| State                                 | Action                                                                                  | Result                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| AI invokes `search_messages`          | Return matching messages, newest first, at most 25 per call (fixed design constraint)   | Result carries the messages, their count, the approximate total of all matches as Discord reports it, and a continuation cursor |
| AI gives `query`                      | Match messages whose text contains the keywords                                         | Finds earlier discussion of a topic                                                                                             |
| AI gives `author` as `self`           | Match messages the assistant sent                                                       | Finds the assistant's earlier summaries                                                                                         |
| AI gives `author` as a member id      | Match messages that member sent                                                         | Finds what a specific member said                                                                                               |
| AI gives `author` as `people`         | Match messages sent by members, leaving out bots and webhooks, the assistant among them | Finds what people said about a topic rather than the assistant's own summaries of it                                            |
| AI gives `involves_self` as `mention` | Match messages that mention the assistant                                               | Finds messages addressed to the assistant                                                                                       |
| AI gives `involves_self` as `reply`   | Match messages that reply to a message the assistant sent                               | Every message returned answers the assistant, including replies that did not notify it                                          |
| AI gives `since` or `until`           | Match only messages sent at or after `since` and before `until`                         | An omitted bound leaves that side open                                                                                          |
| AI gives several conditions           | Match messages satisfying all of them                                                   | Conditions narrow each other                                                                                                    |
| AI gives no condition                 | Match every message in the channel                                                      | The most recent messages are returned                                                                                           |
| More matches remain                   | Return a continuation cursor                                                            | Passing it as `cursor` with the same conditions returns the next older matches                                                  |
| No further matches                    | Return no continuation cursor                                                           | AI knows the matches are exhausted                                                                                              |
| Discord's search index is not ready   | Apply "exponential backoff retry"                                                       | After all retries fail the call fails as a Discord Tool failure                                                                 |

### Memory Tool Interface

Memory Store provides a fixed number of slots indexed from 0 to Memory Entry Limit − 1. Each slot holds a description (max Memory Description Limit characters) and content. AI chooses which slot to read or write, and may only write a slot it has read in the same agent run. Unused slots return empty strings for both description and content.

| State                             | Action                                                                | Result                                                                                          |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AI invokes `list_memories`        | Return index and description for every slot                           | AI receives all slots with index and description; unused slots have empty string as description |
| AI invokes `read_memories(idx[])` | Return full content for each requested slot index                     | AI receives content for specified slots; unused slots return empty string as content            |
| AI invokes `update_memory`        | Write description and content to the specified slot index             | Slot at the given index is created or overwritten                                               |
| AI writes empty content           | `update_memory` receives empty string as content                      | The slot is cleared (description and content become empty string)                               |
| Description exceeds length limit  | `update_memory` receives description longer than configured limit     | System rejects the update and returns an error                                                  |
| AI writes a slot it has not read  | `update_memory` names a slot index absent from this agent run's reads | System rejects the update and tells the AI to read that slot first                              |

## Error Scenarios

| Scenario                                                                                       | System Behavior                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord message history collection fails                                                       | Apply "exponential backoff retry"; after all retries fail, log error, do not send summary                                                                        |
| Discord API request fails (sending summary)                                                    | Apply "exponential backoff retry"; permanent failure logged                                                                                                      |
| No messages found in collection time window                                                    | Send a plain text notice to the designated Discord channel indicating nothing was found in the time window; do not run either agent                              |
| An AI request fails during the Follow-up Agent run                                             | Apply "exponential backoff retry" to that request; the run continues from where it was; after all retries fail, the run fails and "raw message fallback" applies |
| AI output does not conform to expected structure                                               | Treat as AI service failure; apply same fallback behavior                                                                                                        |
| Follow-up Agent run exceeds the Follow-up Token Budget                                         | The run fails without retry; apply "raw message fallback"                                                                                                        |
| Follow-up Agent stops without a list the Goal Check accepted                                   | The run fails without retry; apply "raw message fallback"                                                                                                        |
| Discord authorization service unreachable during sign-in                                       | Sign-in fails; the visitor retries; no grant is created                                                                                                          |
| Discord role lookup fails while deciding access                                                | Access is denied rather than assumed; the visitor retries once Discord is reachable                                                                              |
| Login or confirmation is presented a second time                                               | The second attempt is refused; each sign-in and each confirmation is honoured once                                                                               |
| Memory Tool read/write fails                                                                   | Log warning; AI continues processing without memory assistance (degraded but not interrupted)                                                                    |
| Memory Store reaches Entry Limit                                                               | The Follow-up Agent decides which slot to clear or overwrite to make room for a new item                                                                         |
| GitHub Tool query fails (auth failure, rate limit)                                             | Log warning; AI continues processing without GitHub data assistance (degraded but not interrupted)                                                               |
| Discord Tool query fails (API failure, rate limit, search index still not ready after retries) | Log warning; AI continues processing without the requested messages (degraded but not interrupted)                                                               |
| GitHub App authentication fails                                                                | Apply "exponential backoff retry"; after all retries fail, log error, GitHub Tool unavailable                                                                    |
| Debug endpoint called in production environment                                                | Endpoint does not exist; return standard HTTP 404                                                                                                                |
| Debug endpoint: source channel inaccessible                                                    | Return error indicating the channel could not be accessed; no retry                                                                                              |
| Debug endpoint: Discord message collection fails                                               | Return error with failure reason; no retry (debug context favors fast feedback over resilience)                                                                  |
| Debug endpoint: the Follow-up Agent fails                                                      | Return error with the agent's name and failure reason; no fallback message sent (unlike Daily Follow-up)                                                         |
| Memory Summary Store read fails (at run start)                                                 | Log warning; the run continues without memory context (degraded but not interrupted)                                                                             |
| Memory Agent cannot read memory                                                                | Log warning; skip Memory Summary generation; next run uses previous summary or none                                                                              |
| Memory Agent run fails                                                                         | Log warning; slots already tidied stay tidied; stored summary not updated; next run uses previous summary or none                                                |
| Memory Summary Store write fails                                                               | Log warning; summary lost; next run uses previous summary or none                                                                                                |
| Memory Store read or write fails during an MCP tool call                                       | The tool call reports the failure to the operator; no slot changes and nothing degrades silently                                                                 |
| Memory Summary Store read or write fails during an MCP tool call                               | The tool call reports the failure to the operator; the stored summary is unchanged                                                                               |

## Patterns

### Exponential Backoff Retry

When external service calls (GitHub API, Discord API, AI service) encounter transient failures, the system retries with exponential backoff, up to 3 attempts. Base delay and maximum delay are left to the implementer. After all retries fail, the failure is treated as permanent and handled according to the degradation behavior defined in each Error Scenario.

### Raw Message Fallback

When the Follow-up Agent fails, the system sends a plain text fallback message to the designated Discord channel containing: collected messages sorted by time, preceded by an error notice indicating that AI analysis was unavailable. Messages are truncated to fit the Discord message limit (2000 characters); the most recent messages are kept and the oldest are dropped when the limit is exceeded.

## Terminology

| Term                    | Definition                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary                 | The follow-up list the Follow-up Agent produces and the system sends to the designated channel                                                                                                                                                                                                                                                                             |
| Operator                | A member of the Ruby Taiwan core team responsible for community operations                                                                                                                                                                                                                                                                                                 |
| Command                 | A query request issued by an operator via Discord Slash Command                                                                                                                                                                                                                                                                                                            |
| Follow-up Item          | A structured unfinished item on the follow-up list: status, description, assignee, last progress, and reason                                                                                                                                                                                                                                                               |
| Follow-up Status        | Classification label for follow-up items: to-do, in-progress, or stalled                                                                                                                                                                                                                                                                                                   |
| Memory Tool             | An AI-accessible tool set (`list_memories`, `read_memories`, `update_memory`) for index-based context memory with description and content fields, retaining information across executions                                                                                                                                                                                  |
| GitHub Tool             | An AI-accessible tool set (`list_issues`, `search_issues`, `read_issues`) that retrieves Issues via GitHub App: `list_issues` returns an overview of the Project board with optional state filter; `search_issues` finds Issues in the configured repository by keyword; `read_issues` returns full details including body and recent comments for specified Issue numbers |
| Discord Tool            | An AI-accessible tool set (`read_messages`, `search_messages`) over the designated channel: `read_messages` returns a time range in order, a bounded page per call; `search_messages` returns the messages matching a condition                                                                                                                                            |
| Message Format          | The fields every Discord message carries when handed to the AI: message id, author, timestamp, content, attachments, mentions, and reply target, with the assistant's own account marked wherever it appears                                                                                                                                                               |
| Memory Summary          | Memory Agent output; a condensed context paragraph generated from the tidied memory slots, stored in Memory Summary Store for injection into the next Follow-up Agent run                                                                                                                                                                                                  |
| Follow-up Agent         | The agent that turns collected messages, memory, and tool lookups into the follow-up list, and maintains the memory slots tracking unfinished items                                                                                                                                                                                                                        |
| Memory Agent            | The agent that tidies memory slots after a successful Follow-up Agent run and writes the Memory Summary; it reaches the Memory Tool only                                                                                                                                                                                                                                   |
| Goal Check              | The fixed set of checks a Follow-up Agent run must pass before its list is accepted; judged from the run's tool calls, not from the list's content                                                                                                                                                                                                                         |
| Follow-up Token Budget  | The token ceiling on one Follow-up Agent run, covering every attempt the Goal Check sends back                                                                                                                                                                                                                                                                             |
| MCP Memory Tools        | The tool set an authorized operator reaches through the MCP Management Endpoint: `list_memories`, `read_memories`, `update_memories`, `read_memory_summary`, `write_memory_summary`                                                                                                                                                                                        |
| MCP Management Endpoint | The interface through which an authorized operator reaches the assistant's own data outside a daily run                                                                                                                                                                                                                                                                    |
| Operator Role           | The Discord role, within the configured guild, whose holders are permitted to reach the MCP Management Endpoint                                                                                                                                                                                                                                                            |
| Memory Summary Store    | Persistent KV store holding a single condensed summary string, written by the Memory Agent and read at the start of the next run                                                                                                                                                                                                                                           |
| Schedule                | The mechanism that triggers the daily follow-up run on a timed basis, driven by platform scheduling                                                                                                                                                                                                                                                                        |

## Contracts

| Interaction Point           | Contract                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discord Interaction Webhook | _(Deferred)_ Awaiting design for Feature 2; no contract defined in the current scope                                                                                                                                                                                                                                                                               |
| GitHub API                  | System makes read-only REST/GraphQL API calls using GitHub App Installation Token; also serves as the backend for AI GitHub Tool                                                                                                                                                                                                                                   |
| Discord Bot API             | System sends messages to designated channel, reads channel message history, and searches that channel's messages via Bot Token; also serves as the backend for AI Discord Tool                                                                                                                                                                                     |
| AI Service                  | System runs two agents per daily run through the AI Gateway reached by the platform's AI binding, each request tagged with metadata naming this assistant: the Follow-up Agent loops over tool calls until the Goal Check accepts its list or the Follow-up Token Budget is spent; the Memory Agent loops over Memory Tool calls and returns the condensed summary |
| Memory Store                | The AI and authorized operators read and write fixed-slot memory entries (each with description and content) via persistent store; slot count capped by Memory Entry Limit; description length capped by Memory Description Limit; empty content clears the slot; a write addressing several slots takes effect in full or not at all                              |
| Memory Summary Store        | Persistent KV store holding a single condensed summary string; written by the Memory Agent after a successful run or by an operator through the MCP endpoint; read at the start of the next run to inject into the Follow-up Agent's instructions                                                                                                                  |
| Discord Authorization       | System redirects a visitor to Discord to establish identity, requesting identity scope only; guild role membership is read separately with the assistant's bot credential                                                                                                                                                                                          |
| MCP Client                  | Client registers itself, obtains an access token through the authorization above, and presents that token on every request to the MCP endpoint; a token grants no access once the account behind it stops holding the Operator Role                                                                                                                                |
| MCP Memory Tools            | Named tools reading and writing memory slots and the Memory Summary; every call is subject to the access decision guarding the endpoint                                                                                                                                                                                                                            |
| Cron Trigger                | Platform triggers the daily follow-up run on configured schedule                                                                                                                                                                                                                                                                                                   |
| Debug Summary Endpoint      | Development-only HTTP endpoint; accepts source channel ID and optional hours; returns the follow-up list in response body; does not exist in production                                                                                                                                                                                                            |
