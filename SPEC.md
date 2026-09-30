# Ruby Taiwan Assistant

## Purpose

Provide automated information aggregation and query tools for Ruby Taiwan community operators, reducing the burden of manually tracking GitHub project progress and Discord community discussions.

## Users

| User               | Role                         | Goal                                                                                            |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Community Operator | Ruby Taiwan core team member | Stay informed on community activity, track project progress, respond to community needs quickly |

## Impacts

| Behavior Change       | Current State                                                       | Target State                                                        |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Information Gathering | Operators manually browse GitHub and Discord to stay informed       | System automatically aggregates and pushes daily summaries          |
| Data Querying         | Operators switch to GitHub UI to search Issues or Project status    | _(Deferred)_ Query directly in Discord via commands                 |
| Memory Correction     | Wrong or stale memory can only be displaced by a later pipeline run | Operators inspect and correct memory directly through an MCP client |

## Success Criteria

- After each scheduled trigger, the designated Discord channel receives an AI-generated action item list
- An operator holding the designated Discord role can connect an MCP client and correct memory without waiting for a pipeline run
- A Discord account without that role is refused, and an account that loses it stops being served within one hour
- _(Deferred — see Feature 2)_ Operators can query Issue status and project progress in Discord and get immediate responses

## Non-goals

- Does not create or modify Discord roles, permissions, or memberships; role membership is read to decide access
- Does not provide GitHub Issue creation or modification (read-only access)
- Does not provide features for general community members (operators only)

## Features

### 1. Daily AI Summary

The system collects discussion messages from a designated Discord channel over a configurable time window (default: 24 hours) on a schedule, processes them through a three-phase AI pipeline, and sends a structured action item list to the same Discord channel.

**Processing Pipeline:**

| Phase                          | Input                                                   | Output                                                                                      |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Data Collection                | Discord channel message history                         | Time-sorted message list (with author, content, timestamp, attachments, mentions)           |
| Phase 1: Conversation Grouping | Sorted message list + stored Memory Summary (if exists) | Topic groups, each with a summary and attribute tags (see Attribute Tags below)             |
| Phase 2: Action Items          | Topic groups + stored Memory Summary (if exists)        | Structured action item list, each with status, assignee, and task description               |
| Phase 3: Memory Summary        | All memory slots as Markdown (after Phase 2 updates)    | Condensed plain-text summary (≤ Memory Summary Length Limit) stored to Memory Summary Store |

**Attribute Tags (closed enumeration):**

| Tag                 | Values   | Meaning                                                             |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `community-related` | yes / no | Whether the topic relates to Ruby Taiwan community activity         |
| `small-talk`        | yes / no | Whether the topic is casual conversation without actionable content |
| `lost-context`      | yes / no | Whether the topic lacks sufficient context to determine intent      |

**AI Available Tools:**

| Tool         | Capability                                                                                  | Purpose                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Memory Tool  | Read and write index-based context memory (see Memory Tool Interface below)                 | Retain important context across executions, avoid redundant processing         |
| GitHub Tool  | List, search, and read Issues (see GitHub Tool Query below)                                 | Verify task status, relate conversations to existing issues                    |
| Discord Tool | Read and search the designated channel's messages in bounded pages (see Discord Tool Query) | Recover context outside the collected window; find what involved the assistant |

**User Journey:**

| Context                          | Action                                             | Outcome                                                             |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Operator starts their daily work | System has already sent summary to Discord channel | Operator reads action item list to grasp recent activity and to-dos |

### 2. Discord Interaction Commands (Deferred)

Operators issue query commands via Slash Commands in Discord. The system retrieves data through the GitHub App and responds. This feature is awaiting design and no part of it is in the current implementation scope; both the Discord Interaction Webhook handling and the command behaviors will be defined in a future specification iteration.

### 3. GitHub App Integration

The system is installed as a GitHub App on the Ruby Taiwan organization with read-only permissions to access Project and Issues data, serving as the data source for daily summaries and interaction commands.

**User Journey:**

| Context                            | Action                                           | Outcome                                 |
| ---------------------------------- | ------------------------------------------------ | --------------------------------------- |
| System needs to access GitHub data | Authenticate via GitHub App and send API request | Retrieve latest Project and Issues data |

### 4. Debug Summary Preview

A development-only HTTP endpoint that triggers the same AI summary pipeline as Feature 1, but returns the result directly in the HTTP response instead of sending it to a Discord channel. This allows operators to inspect and verify AI parsing output without polluting any channel.

**Constraints:**

| Aspect          | Decision                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Availability    | Development environment only; the endpoint does not exist in production                                               |
| Network origin  | Only requests from localhost are accepted; non-local requests are rejected even if the endpoint happens to be mounted |
| Authentication  | None; environment isolation and localhost restriction are the sole access control mechanisms                          |
| Result delivery | HTTP response body containing pipeline intermediate results (topic groups and action items); no Discord message sent  |
| Side effects    | The run writes the Memory Summary the next production run reads; memory slots the AI updates persist                  |
| Prerequisites   | Development environment must have access to the same Discord Bot Token and AI Service as production                   |

**Parameters:**

| Parameter         | Description                              | Required                                                |
| ----------------- | ---------------------------------------- | ------------------------------------------------------- |
| Source Channel ID | Discord channel to collect messages from | Yes                                                     |
| Hours             | Time window for message collection       | No (defaults to Summary Collection Hours configuration) |

**User Journey:**

| Context                                                           | Action                                                       | Outcome                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Operator is tuning AI summary behavior and wants to verify output | Send HTTP request to debug endpoint with a source channel ID | Operator receives the full pipeline result (topic groups and action items) in the response and can inspect correctness |

### 5. MCP Management Endpoint

An MCP endpoint carries the assistant's own data to operators between pipeline runs. Memory slots and the Memory Summary are readable and writable through named tools; several slots may be corrected in one call. Reading Project Issues through this endpoint is deferred and no tool exposes them in the current scope.

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
| Summary Item Limit              | Maximum number of action items per summary                                                                  | 30                     |
| Memory Entry Limit              | Maximum number of memory slots for Memory Tool                                                              | 32                     |
| Memory Description Limit        | Maximum character length for memory slot description                                                        | 128                    |
| Memory Summary Length Limit     | Maximum character length for the Memory Summary, whether generated or operator-written                      | 300                    |
| Issue Body Length Limit         | Maximum character length for an Issue body, and for each comment, in read_issues result                     | 500                    |
| Discord Guild ID                | Guild whose role membership decides MCP endpoint access                                                     | (required, no default) |
| Operator Role ID                | Role within that guild that grants MCP endpoint access                                                      | (required, no default) |
| Discord Application Credentials | Client ID and secret identifying the assistant to Discord's authorization service                           | (required, no default) |

## System Boundary

| Aspect         | Inside System                                                                                                                                                                                                                                         | Outside System                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Responsibility | Data collection, three-phase AI summary generation, memory management, memory summary generation, query responses, deciding who may reach the MCP endpoint                                                                                            | Discord server administration, GitHub project management, deciding who holds the Operator Role                         |
| Interaction    | Receive Discord Interaction Webhook; call GitHub API and AI service; read and search channel message history; read/write persistent memory store; read/write Memory Summary Store; read guild role membership; issue and revalidate MCP access tokens | Authenticating the person behind a Discord account; GitHub permission settings; Discord channel and role configuration |
| Control        | Summary schedule and content format; channel and collection hours configuration; memory entry limit; which guild and role grant MCP access                                                                                                            | Discord channel and role configuration; GitHub Project structure                                                       |

## Behaviors

### Daily AI Summary

#### Data Collection

| State                               | Action                                                                  | Result                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Scheduled time reached              | Trigger summary generation pipeline                                     | System begins collecting data                                                       |
| Discord message history collected   | Retrieve messages from designated channel within configured time window | Messages ordered oldest first, each in the Message Format (see Discord Tool Query)  |
| Window holds more than 500 messages | Keep the earliest 500 (fixed design constraint, not configurable)       | The pipeline works with the earliest 500; later messages in the window are left out |

#### Memory Summary Injection

At the start of each pipeline run, before Phase 1, the system reads the previously stored Memory Summary and appends it to the end of Phase 1 and Phase 2 system prompts.

| State                    | Action                                                          | Result                                                                 |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Data collection complete | Read stored Memory Summary from Memory Summary Store            | Previously generated summary retrieved                                 |
| No stored summary exists | Skip injection                                                  | Phase 1 and Phase 2 system prompts contain no memory context paragraph |
| Stored summary exists    | Append summary to the end of Phase 1 and Phase 2 system prompts | Both phases begin with historical context awareness                    |

#### Phase 1: Conversation Grouping

| State                                                                                    | Action                                                                                                               | Result                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sorted message list received                                                             | AI identifies existing action items from the assistant's own earlier summaries among the messages                    | Existing action items considered during grouping to avoid duplication; an earlier summary is what the assistant concluded, not new evidence about the item |
| Existing action item is carried forward                                                  | AI looks through Discord Tool for the most recent discussion of the item by people, and for replies to its summaries | Discussion or a correction later than the assistant's last summary updates the item                                                                        |
| No discussion of a carried-forward item later than the assistant's last summary is found | AI carries the item forward unchanged                                                                                | The group summary states that nothing new was said since that summary                                                                                      |
| Existing action items identified                                                         | AI groups messages by topic and context, tagging each group with attribute tags (see Attribute Tags)                 | Topic group list produced, each with summary and attribute tags                                                                                            |
| Grouping complete                                                                        | AI may read/update cross-execution context memory via Memory Tool                                                    | Memory assists grouping decisions; updated after processing for next run                                                                                   |
| Grouping complete                                                                        | AI may query Projects and Issues via GitHub Tool                                                                     | GitHub data assists in determining whether messages relate to existing tasks                                                                               |
| Grouping complete                                                                        | AI may read or search earlier channel messages via Discord Tool                                                      | Earlier messages supply context a topic lacks within the collected window                                                                                  |

#### Phase 2: Action Item Generation

| State                      | Action                                                                                                                                     | Result                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Topic group list received  | AI retains only groups where `community-related=yes` AND `small-talk=no` AND `lost-context=no`; all other groups are excluded              | Only community-relevant, actionable groups retained                                |
| Relevant groups filtered   | AI generates an action item for each group, classified as to-do, in-progress, done, stalled, or discussion                                 | At most one action item per group, with assignee and task description              |
| Action items generated     | AI may update memory via Memory Tool; may verify task status via GitHub Tool; may read or search earlier channel messages via Discord Tool | Memory, GitHub data, and earlier messages assist action item status classification |
| All action items generated | Compile into action item list (capped by config), formatted as `- [STATUS] Description (Assignee)` (see Action Item Status Display below)  | Plain text message sent to designated Discord channel for operators to read        |

**Action Item Status Display:**

| Status      | Display Text    |
| ----------- | --------------- |
| to-do       | `[TODO]`        |
| in-progress | `[IN-PROGRESS]` |
| done        | `[DONE]`        |
| stalled     | `[STALLED]`     |
| discussion  | `[DISCUSSION]`  |

#### Phase 3: Memory Summary

Phase 3 uses an independent AI call with its own system prompt. All non-empty memory slots are formatted as Markdown and passed as user input. No tools are available to the AI in this phase (no Memory Tool, no GitHub Tool, no Discord Tool).

| State                 | Action                                                                        | Result                                                             |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Phase 2 complete      | Read all memory slots from Memory Store                                       | All slots retrieved with description and content                   |
| All slots empty       | Skip summary generation                                                       | Memory Summary Store not updated; next run has no injected context |
| Non-empty slots exist | Format slots as Markdown user input; generate summary via independent AI call | Plain-text paragraph (≤ Memory Summary Length Limit) produced      |
| Summary generated     | Write summary to Memory Summary Store (KV)                                    | Summary persisted for next pipeline run                            |

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
| Operator invokes `write_memory_summary`                                                             | Replace the stored Memory Summary                                 | The next pipeline run injects the operator's text in place of the last generated summary                         |
| Summary exceeds Memory Summary Length Limit                                                         | Refuse the write                                                  | The stored summary is unchanged and the operator is told the limit                                               |

### Debug Summary Preview

| State                                                  | Action                                                                                                                | Result                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Debug endpoint receives request with source channel ID | Collect messages from specified channel within time window                                                            | Messages retrieved using same data collection logic as Daily AI Summary                        |
| Messages collected                                     | Execute full AI pipeline (Memory Summary Injection → Conversation Grouping → Action Item Generation → Memory Summary) | Same behavior as Daily AI Summary; topic groups, action items produced, Memory Summary updated |
| Pipeline complete                                      | Return intermediate results in HTTP response                                                                          | Response contains topic groups and action items as structured data; no Discord message sent    |
| No messages found in time window                       | Skip AI pipeline                                                                                                      | Return empty result indicating no messages found                                               |

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

Every message the system hands to the AI, whether collected for the pipeline or returned by a Discord Tool operation, carries the same fields. A message with no text content is not returned.

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
| AI omits `since`                  | Start Summary Collection Hours before now                                 | The default range is the window the pipeline collects                       |
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

Memory Store provides a fixed number of slots indexed from 0 to Memory Entry Limit − 1. Each slot holds a description (max Memory Description Limit characters) and content. AI chooses which slot to read or write, and may only write a slot it has read in the same run. Unused slots return empty strings for both description and content.

| State                             | Action                                                            | Result                                                                                          |
| --------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AI invokes `list_memories`        | Return index and description for every slot                       | AI receives all slots with index and description; unused slots have empty string as description |
| AI invokes `read_memories(idx[])` | Return full content for each requested slot index                 | AI receives content for specified slots; unused slots return empty string as content            |
| AI invokes `update_memory`        | Write description and content to the specified slot index         | Slot at the given index is created or overwritten                                               |
| AI writes empty content           | `update_memory` receives empty string as content                  | The slot is cleared (description and content become empty string)                               |
| Description exceeds length limit  | `update_memory` receives description longer than configured limit | System rejects the update and returns an error                                                  |
| AI writes a slot it has not read  | `update_memory` names a slot index absent from this run's reads   | System rejects the update and tells the AI to read that slot first                              |

## Error Scenarios

| Scenario                                                                                       | System Behavior                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord message history collection fails                                                       | Apply "exponential backoff retry"; after all retries fail, log error, do not send summary                                                                |
| Discord API request fails (sending summary)                                                    | Apply "exponential backoff retry"; permanent failure logged                                                                                              |
| No messages found in collection time window                                                    | Send a plain text notice to the designated Discord channel indicating no actionable discussions were found in the time window; do not invoke AI pipeline |
| AI service fails to complete grouping or action item generation                                | Apply "exponential backoff retry"; after all retries fail, apply "raw message fallback"                                                                  |
| AI output does not conform to expected structure                                               | Treat as AI service failure; apply same fallback behavior                                                                                                |
| Discord authorization service unreachable during sign-in                                       | Sign-in fails; the visitor retries; no grant is created                                                                                                  |
| Discord role lookup fails while deciding access                                                | Access is denied rather than assumed; the visitor retries once Discord is reachable                                                                      |
| Login or confirmation is presented a second time                                               | The second attempt is refused; each sign-in and each confirmation is honoured once                                                                       |
| Memory Tool read/write fails                                                                   | Log warning; AI continues processing without memory assistance (degraded but not interrupted)                                                            |
| Memory Store reaches Entry Limit                                                               | AI decides eviction strategy (clear slots by writing empty content, or overwrite existing slots) to make room for new entries                            |
| GitHub Tool query fails (auth failure, rate limit)                                             | Log warning; AI continues processing without GitHub data assistance (degraded but not interrupted)                                                       |
| Discord Tool query fails (API failure, rate limit, search index still not ready after retries) | Log warning; AI continues processing without the requested messages (degraded but not interrupted)                                                       |
| GitHub App authentication fails                                                                | Apply "exponential backoff retry"; after all retries fail, log error, GitHub Tool unavailable                                                            |
| Debug endpoint called in production environment                                                | Endpoint does not exist; return standard HTTP 404                                                                                                        |
| Debug endpoint: source channel inaccessible                                                    | Return error indicating the channel could not be accessed; no retry                                                                                      |
| Debug endpoint: Discord message collection fails                                               | Return error with failure reason; no retry (debug context favors fast feedback over resilience)                                                          |
| Debug endpoint: AI pipeline fails                                                              | Return error with the failed phase name and failure reason; no fallback message sent, no retry (unlike Daily AI Summary)                                 |
| Memory Summary Store read fails (at pipeline start)                                            | Log warning; pipeline continues without memory context (degraded but not interrupted)                                                                    |
| Memory Store read fails (before Phase 3)                                                       | Log warning; skip Memory Summary generation; next run uses previous summary or none                                                                      |
| Memory Summary AI call fails (after Phase 2)                                                   | Log warning; stored summary not updated; next run uses previous summary or none                                                                          |
| Memory Summary Store write fails (after Phase 2)                                               | Log warning; summary lost; next run uses previous summary or none                                                                                        |
| Memory Store read or write fails during an MCP tool call                                       | The tool call reports the failure to the operator; no slot changes and nothing degrades silently                                                         |
| Memory Summary Store read or write fails during an MCP tool call                               | The tool call reports the failure to the operator; the stored summary is unchanged                                                                       |

## Patterns

### Exponential Backoff Retry

When external service calls (GitHub API, Discord API, AI service) encounter transient failures, the system retries with exponential backoff, up to 3 attempts. Base delay and maximum delay are left to the implementer. After all retries fail, the failure is treated as permanent and handled according to the degradation behavior defined in each Error Scenario.

### Raw Message Fallback

When the AI pipeline fails after all retries, the system sends a plain text fallback message to the designated Discord channel containing: collected messages sorted by time, preceded by an error notice indicating that AI analysis was unavailable. Messages are truncated to fit the Discord message limit (2000 characters); the most recent messages are kept and the oldest are dropped when the limit is exceeded.

## Terminology

| Term                    | Definition                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary                 | Structured action item list produced by the AI pipeline                                                                                                                                                                                                                                                                                                                    |
| Operator                | A member of the Ruby Taiwan core team responsible for community operations                                                                                                                                                                                                                                                                                                 |
| Command                 | A query request issued by an operator via Discord Slash Command                                                                                                                                                                                                                                                                                                            |
| Group                   | Phase 1 output; aggregates contextually related conversation messages into a topic group with summary and attribute tags                                                                                                                                                                                                                                                   |
| Action Item             | Phase 2 output; a structured to-do extracted from a group, containing status, assignee, and task description                                                                                                                                                                                                                                                               |
| Action Item Status      | Classification label for action items: to-do, in-progress, done, stalled, or discussion                                                                                                                                                                                                                                                                                    |
| Memory Tool             | An AI-accessible tool set (`list_memories`, `read_memories`, `update_memory`) for index-based context memory with description and content fields, retaining information across executions                                                                                                                                                                                  |
| GitHub Tool             | An AI-accessible tool set (`list_issues`, `search_issues`, `read_issues`) that retrieves Issues via GitHub App: `list_issues` returns an overview of the Project board with optional state filter; `search_issues` finds Issues in the configured repository by keyword; `read_issues` returns full details including body and recent comments for specified Issue numbers |
| Discord Tool            | An AI-accessible tool set (`read_messages`, `search_messages`) over the designated channel: `read_messages` returns a time range in order, a bounded page per call; `search_messages` returns the messages matching a condition                                                                                                                                            |
| Message Format          | The fields every Discord message carries when handed to the AI: message id, author, timestamp, content, attachments, mentions, and reply target, with the assistant's own account marked wherever it appears                                                                                                                                                               |
| Memory Summary          | Phase 3 output; a condensed context paragraph generated from all memory slots after Phase 2, stored in Memory Summary Store for injection into subsequent pipeline runs                                                                                                                                                                                                    |
| MCP Memory Tools        | The tool set an authorized operator reaches through the MCP Management Endpoint: `list_memories`, `read_memories`, `update_memories`, `read_memory_summary`, `write_memory_summary`                                                                                                                                                                                        |
| MCP Management Endpoint | The interface through which an authorized operator reaches the assistant's own data outside a pipeline run                                                                                                                                                                                                                                                                 |
| Operator Role           | The Discord role, within the configured guild, whose holders are permitted to reach the MCP Management Endpoint                                                                                                                                                                                                                                                            |
| Memory Summary Store    | Persistent KV store holding a single condensed summary string, written after each pipeline run and read at the start of the next run                                                                                                                                                                                                                                       |
| Schedule                | The mechanism that triggers the summary generation pipeline on a timed basis, driven by platform scheduling                                                                                                                                                                                                                                                                |

## Contracts

| Interaction Point           | Contract                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord Interaction Webhook | _(Deferred)_ Awaiting design for Feature 2; no contract defined in the current scope                                                                                                                                                                                                                                                  |
| GitHub API                  | System makes read-only REST/GraphQL API calls using GitHub App Installation Token; also serves as the backend for AI GitHub Tool                                                                                                                                                                                                      |
| Discord Bot API             | System sends messages to designated channel, reads channel message history, and searches that channel's messages via Bot Token; also serves as the backend for AI Discord Tool                                                                                                                                                        |
| AI Service                  | System makes three separate AI service calls: Phase 1 receives message list and produces groups; Phase 2 receives groups and produces action item list; Phase 3 receives all memory slots and produces a condensed summary. Each phase is an independent request-response cycle.                                                      |
| Memory Store                | The AI and authorized operators read and write fixed-slot memory entries (each with description and content) via persistent store; slot count capped by Memory Entry Limit; description length capped by Memory Description Limit; empty content clears the slot; a write addressing several slots takes effect in full or not at all |
| Memory Summary Store        | Persistent KV store holding a single condensed summary string; written by Phase 3 after each pipeline run or by an operator through the MCP endpoint; read at the start of the next run to inject into Phase 1 and Phase 2 system prompts                                                                                             |
| Discord Authorization       | System redirects a visitor to Discord to establish identity, requesting identity scope only; guild role membership is read separately with the assistant's bot credential                                                                                                                                                             |
| MCP Client                  | Client registers itself, obtains an access token through the authorization above, and presents that token on every request to the MCP endpoint; a token grants no access once the account behind it stops holding the Operator Role                                                                                                   |
| MCP Memory Tools            | Named tools reading and writing memory slots and the Memory Summary; every call is subject to the access decision guarding the endpoint                                                                                                                                                                                               |
| Cron Trigger                | Platform triggers summary generation pipeline on configured schedule                                                                                                                                                                                                                                                                  |
| Debug Summary Endpoint      | Development-only HTTP endpoint; accepts source channel ID and optional hours; returns pipeline result in response body; does not exist in production                                                                                                                                                                                  |
