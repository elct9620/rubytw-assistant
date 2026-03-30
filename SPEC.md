# Ruby Taiwan Assistant

## Purpose

Provide automated information aggregation and query tools for Ruby Taiwan community operators, reducing the burden of manually tracking GitHub project progress and Discord community discussions.

## Users

| User               | Role                         | Goal                                                                                            |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Community Operator | Ruby Taiwan core team member | Stay informed on community activity, track project progress, respond to community needs quickly |

## Impacts

| Behavior Change       | Current State                                                    | Target State                                               |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Information Gathering | Operators manually browse GitHub and Discord to stay informed    | System automatically aggregates and pushes daily summaries |
| Data Querying         | Operators switch to GitHub UI to search Issues or Project status | _(Deferred)_ Query directly in Discord via commands        |

## Success Criteria

- After each scheduled trigger, the designated Discord channel receives an AI-generated action item list
- _(Deferred — see Feature 2)_ Operators can query Issue status and project progress in Discord and get immediate responses

## Non-goals

- Does not handle Discord user permission management
- Does not provide GitHub Issue creation or modification (read-only access)
- Does not provide features for general community members (operators only)

## Features

### 1. Daily AI Summary

The system collects discussion messages from a designated Discord channel over a configurable time window (default: 24 hours) on a schedule, processes them through a two-phase AI pipeline, and sends a structured action item list to the same Discord channel.

**Processing Pipeline:**

| Phase                          | Input                           | Output                                                                                |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------- |
| Data Collection                | Discord channel message history | Time-sorted message list (with author, content, timestamp, attachments, mentions)     |
| Phase 1: Conversation Grouping | Sorted message list             | Topic groups, each with a summary and attribute tags (see Attribute Tags below)       |
| Phase 2: Action Items          | Topic groups                    | Structured action item list, each with status, assignee, task description, and reason |

**Attribute Tags (closed enumeration):**

| Tag                 | Values   | Meaning                                                             |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `community-related` | yes / no | Whether the topic relates to Ruby Taiwan community activity         |
| `small-talk`        | yes / no | Whether the topic is casual conversation without actionable content |
| `lost-context`      | yes / no | Whether the topic lacks sufficient context to determine intent      |

**AI Available Tools:**

| Tool        | Capability                                                                                    | Purpose                                                                |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Memory Tool | Read/write context memory with AI-determined structure (entry count capped by config)         | Retain important context across executions, avoid redundant processing |
| GitHub Tool | Query Issues from GitHub Projects V2 with optional state filter (see GitHub Tool Query below) | Verify task status, relate conversations to existing issues            |

**User Journey:**

| Context                          | Action                                             | Outcome                                                             |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Operator starts their daily work | System has already sent summary to Discord channel | Operator reads action item list to grasp recent activity and to-dos |

### 2. Discord Interaction Commands (Deferred)

Operators issue query commands via Slash Commands in Discord. The system retrieves data through the GitHub App and responds. This feature is outside the current target scope; only the Discord Interaction Webhook verification (required for the platform integration) is implemented now. Command behaviors will be defined in a future specification iteration.

### 3. GitHub App Integration

The system is installed as a GitHub App on the Ruby Taiwan organization with read-only permissions to access Project and Issues data, serving as the data source for daily summaries and interaction commands.

**User Journey:**

| Context                            | Action                                           | Outcome                                 |
| ---------------------------------- | ------------------------------------------------ | --------------------------------------- |
| System needs to access GitHub data | Authenticate via GitHub App and send API request | Retrieve latest Project and Issues data |

### 4. Debug Summary Preview

A development-only HTTP endpoint that triggers the same AI summary pipeline as Feature 1, but returns the result directly in the HTTP response instead of sending it to a Discord channel. This allows operators to inspect and verify AI parsing output without polluting any channel.

**Constraints:**

| Aspect          | Decision                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Availability    | Development environment only; the endpoint does not exist in production                                              |
| Authentication  | None; environment isolation is the sole access control mechanism                                                     |
| Result delivery | HTTP response body containing pipeline intermediate results (topic groups and action items); no Discord message sent |
| Prerequisites   | Development environment must have access to the same Discord Bot Token and AI Service as production                  |

**Parameters:**

| Parameter         | Description                              | Required                                                |
| ----------------- | ---------------------------------------- | ------------------------------------------------------- |
| Source Channel ID | Discord channel to collect messages from | Yes                                                     |
| Hours             | Time window for message collection       | No (defaults to Summary Collection Hours configuration) |

**User Journey:**

| Context                                                           | Action                                                       | Outcome                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Operator is tuning AI summary behavior and wants to verify output | Send HTTP request to debug endpoint with a source channel ID | Operator receives the full pipeline result (topic groups and action items) in the response and can inspect correctness |

## Configuration

| Setting                  | Description                                                    | Default                |
| ------------------------ | -------------------------------------------------------------- | ---------------------- |
| Discord Channel ID       | Designated channel for summary delivery and message collection | (required, no default) |
| Summary Collection Hours | Collect Discord messages from the past N hours                 | 24                     |
| Summary Item Limit       | Maximum number of action items per summary                     | 30                     |
| Memory Entry Limit       | Maximum number of memory entries for Memory Tool               | 32                     |

## System Boundary

| Aspect         | Inside System                                                                                                                         | Outside System                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Responsibility | Data collection, two-phase AI summary generation, memory management, query responses                                                  | Discord server administration, GitHub project management                               |
| Interaction    | Receive Discord Interaction Webhook; call GitHub API and AI service; read channel message history; read/write persistent memory store | Discord user authentication; GitHub permission settings; Discord channel configuration |
| Control        | Summary schedule and content format; channel and collection hours configuration; memory entry limit                                   | Discord channel configuration; GitHub Project structure                                |

## Behaviors

### Daily AI Summary

#### Data Collection

| State                             | Action                                                                  | Result                                                                             |
| --------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Scheduled time reached            | Trigger summary generation pipeline                                     | System begins collecting data                                                      |
| Discord message history collected | Retrieve messages from designated channel within configured time window | Messages sorted by time; extract author, content, timestamp, attachments, mentions |

#### Phase 1: Conversation Grouping

| State                            | Action                                                                                               | Result                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sorted message list received     | AI identifies existing action items from bot messages (previous summaries)                           | Existing action items considered during grouping to avoid duplication        |
| Existing action items identified | AI groups messages by topic and context, tagging each group with attribute tags (see Attribute Tags) | Topic group list produced, each with summary and attribute tags              |
| Grouping complete                | AI may read/update cross-execution context memory via Memory Tool                                    | Memory assists grouping decisions; updated after processing for next run     |
| Grouping complete                | AI may query Projects and Issues via GitHub Tool                                                     | GitHub data assists in determining whether messages relate to existing tasks |

#### Phase 2: Action Item Generation

| State                      | Action                                                                                                      | Result                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Topic group list received  | AI filters out groups with `community-related=no`, `small-talk=yes`, or `lost-context=yes`                  | Only community-relevant, actionable groups retained                            |
| Relevant groups filtered   | AI generates an action item for each group, classified as to-do, in-progress, done, stalled, or discussion  | At most one action item per group, with assignee, task description, and reason |
| Action items generated     | AI may update memory via Memory Tool; may verify task status via GitHub Tool                                | Memory and GitHub data assist action item status classification                |
| All action items generated | Compile into action item list (capped by config), formatted as `- [Status] Description (Assignee) — Reason` | List sent to designated Discord channel for operators to read                  |

### Debug Summary Preview

| State                                                  | Action                                                                    | Result                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Debug endpoint receives request with source channel ID | Collect messages from specified channel within time window                | Messages retrieved using same data collection logic as Daily AI Summary                          |
| Messages collected                                     | Execute full AI pipeline (Conversation Grouping → Action Item Generation) | Topic groups (with summaries and attribute tags) and action items produced                       |
| Pipeline complete                                      | Return intermediate results in HTTP response                              | Response contains topic groups and action items as structured data; no Discord message sent      |
| No messages found in time window                       | Skip AI pipeline                                                          | Return empty result indicating no messages found                                                 |
| Source channel ID is invalid or inaccessible           | Discord API returns error                                                 | Return error indicating the channel could not be accessed                                        |
| Discord message collection fails                       | Transient or permanent API failure                                        | Return error indicating collection failure with the failure reason; do not retry (debug context) |

### Discord Interaction Commands (Deferred)

| State                                | Action                   | Result                                              |
| ------------------------------------ | ------------------------ | --------------------------------------------------- |
| Discord Interaction Webhook received | Verify request signature | Process command if valid; reject request if invalid |

Command behavior definitions are deferred until Feature 2 is specified. Only webhook signature verification is in the current scope.

### GitHub App Integration

| State                     | Action                                                  | Result                             |
| ------------------------- | ------------------------------------------------------- | ---------------------------------- |
| GitHub data access needed | Use App credentials to obtain Installation Access Token | Obtain time-limited access token   |
| Access Token valid        | Send GitHub API request                                 | Retrieve requested data            |
| Access Token expired      | Re-obtain Installation Access Token                     | Retry request with refreshed token |

### GitHub Tool Query

| State                             | Action                                                                   | Result                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| AI invokes GitHub Tool            | Query Project V2 items; filter to Issues only (exclude PRs, DraftIssues) | Return Issue list with: title, number, state, url, labels, assignees, project status field, due date |
| AI specifies state filter         | Apply state filter (OPEN or CLOSED) to Issue list                        | Return only Issues matching the specified state                                                      |
| AI specifies due date range       | Apply due date range filter (from/to) to Issue list                      | Return only Issues with due date within the specified range; Issues without due date are excluded    |
| AI omits all filters              | Return all Issues regardless of state or due date                        | AI determines relevance based on state and due date fields in the returned data                      |
| Project has more items than limit | Return at most 50 Issues per query                                       | AI works with available data; may miss items beyond the limit                                        |

## Error Scenarios

| Scenario                                                        | System Behavior                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Discord message history collection fails                        | Apply "exponential backoff retry"; after all retries fail, log error, do not send summary                                |
| Discord API request fails (sending summary)                     | Apply "exponential backoff retry"; permanent failure logged                                                              |
| No messages found in collection time window                     | Send a "no action items" notice to the designated Discord channel; do not invoke AI pipeline                             |
| AI service fails to complete grouping or action item generation | Apply "exponential backoff retry"; after all retries fail, apply "raw message fallback"                                  |
| AI output does not conform to expected structure                | Treat as AI service failure; apply same fallback behavior                                                                |
| Memory Tool read/write fails                                    | Log warning; AI continues processing without memory assistance (degraded but not interrupted)                            |
| Memory Store reaches Entry Limit                                | AI decides eviction strategy (merge or overwrite existing entries) to make room for new entries                          |
| GitHub Tool query fails (auth failure, rate limit)              | Log warning; AI continues processing without GitHub data assistance (degraded but not interrupted)                       |
| GitHub App authentication fails                                 | Apply "exponential backoff retry"; after all retries fail, log error, GitHub Tool unavailable                            |
| Interaction command timeout (platform time limit)               | Reply with timeout notice, suggest retrying later                                                                        |
| Debug endpoint called in production environment                 | Endpoint does not exist; return standard HTTP 404                                                                        |
| Debug endpoint: source channel inaccessible                     | Return error indicating the channel could not be accessed; no retry                                                      |
| Debug endpoint: Discord message collection fails                | Return error with failure reason; no retry (debug context favors fast feedback over resilience)                          |
| Debug endpoint: AI pipeline fails                               | Return error with the failed phase name and failure reason; no fallback message sent, no retry (unlike Daily AI Summary) |

## Patterns

### Exponential Backoff Retry

When external service calls (GitHub API, Discord API, AI service) encounter transient failures, the system retries with exponential backoff, up to 3 attempts. After all retries fail, the failure is treated as permanent and handled according to the degradation behavior defined in each Error Scenario.

### Raw Message Fallback

When the AI pipeline fails after all retries, the system sends a fallback message to the designated Discord channel containing: collected messages sorted by time and truncated to fit Discord message limits, preceded by an error notice indicating that AI analysis was unavailable.

## Terminology

| Term               | Definition                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Summary            | Structured action item list produced by the two-phase AI pipeline                                                                   |
| Operator           | A member of the Ruby Taiwan core team responsible for community operations                                                          |
| Command            | A query request issued by an operator via Discord Slash Command                                                                     |
| Group              | Phase 1 output; aggregates contextually related conversation messages into a topic group with summary and attribute tags            |
| Action Item        | Phase 2 output; a structured to-do extracted from a group, containing status, assignee, task description, and reason                |
| Action Item Status | Classification label for action items: to-do, in-progress, done, stalled, or discussion                                             |
| Memory Tool        | An AI-accessible tool that reads and writes context memory with AI-determined structure for retaining information across executions |
| GitHub Tool        | An AI-accessible query tool that retrieves Issues from GitHub Projects V2 with optional state and due date filters via GitHub App   |
| Schedule           | The mechanism that triggers the summary generation pipeline on a timed basis, driven by platform scheduling                         |

## Contracts

| Interaction Point           | Contract                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord Interaction Webhook | System receives HTTP POST requests, verifies Ed25519 signature, processes commands, returns JSON response                                                                                                  |
| GitHub API                  | System makes read-only REST/GraphQL API calls using GitHub App Installation Token; also serves as the backend for AI GitHub Tool                                                                           |
| Discord Bot API             | System sends messages to designated channel and reads channel message history via Bot Token                                                                                                                |
| AI Service                  | System makes two separate AI service calls: Phase 1 receives message list and produces groups; Phase 2 receives groups and produces action item list. Each phase is an independent request-response cycle. |
| Memory Store                | AI reads and writes structured memory entries via persistent key-value store; entry count capped by configuration                                                                                          |
| Cron Trigger                | Platform triggers summary generation pipeline on configured schedule                                                                                                                                       |
| Debug Summary Endpoint      | Development-only HTTP endpoint; accepts source channel ID and optional hours; returns pipeline result in response body; does not exist in production                                                       |
