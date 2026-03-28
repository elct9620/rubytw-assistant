# Ruby Taiwan Assistant

## Purpose

Provide automated information aggregation and query tools for Ruby Taiwan community operators, reducing the burden of manually tracking GitHub project progress and Discord community discussions.

## Users

| User               | Role                        | Goal                                                          |
| ------------------ | --------------------------- | ------------------------------------------------------------- |
| Community Operator | Ruby Taiwan core team member | Stay informed on community activity, track project progress, respond to community needs quickly |

## Impacts

| Behavior Change       | Current State                                                    | Target State                              |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| Information Gathering | Operators manually browse GitHub and Discord to stay informed    | System automatically aggregates and pushes daily summaries |
| Data Querying         | Operators switch to GitHub UI to search Issues or Project status | Query directly in Discord via commands    |

## Success Criteria

- Operators receive a daily AI-generated action item list based on Discord discussions
- Operators can query Issue status and project progress in Discord and get immediate responses

## Non-goals

- Does not handle Discord user permission management
- Does not provide GitHub Issue creation or modification (read-only access)
- Does not provide features for general community members (operators only)

## Features

### 1. Daily AI Summary

The system collects discussion messages from a designated Discord channel over a configurable time window (default: 24 hours) on a schedule, processes them through a two-phase AI pipeline, and sends a structured action item list to the same Discord channel.

**Processing Pipeline:**

| Phase                    | Input                          | Output                                                                  |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| Data Collection          | Discord channel message history | Time-sorted message list (with author, content, timestamp, attachments, mentions) |
| Phase 1: Conversation Grouping | Sorted message list       | Topic groups, each with a summary and attribute tags (community-related, small talk, lost context) |
| Phase 2: Action Items    | Topic groups                   | Structured action item list, each with status, assignee, task description, and reason |

**AI Available Tools:**

| Tool        | Capability                                        | Purpose                                              |
| ----------- | ------------------------------------------------- | ---------------------------------------------------- |
| Memory Tool | Read/write structured context memory (capped by config) | Retain important context across executions, avoid redundant processing |
| GitHub Tool | Read-only access to GitHub Projects and Issues    | Verify task status, assist action item classification |

**User Journey:**

| Context                            | Action                                          | Outcome                                                        |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Operator starts their daily work   | System has already sent summary to Discord channel | Operator reads action item list to grasp recent activity and to-dos |

### 2. Discord Interaction Commands

Operators issue query commands via Slash Commands in Discord. The system retrieves data through the GitHub App and responds.

**User Journey:**

| Context                                       | Action                              | Outcome                  |
| --------------------------------------------- | ----------------------------------- | ------------------------ |
| Operator needs to check a specific Issue or project status | Enter Slash Command in Discord | System responds with query results |

**To be decided:**

- Supported command list and parameter formats
- Query result display format
- Access control mechanism (how to restrict to operators only)

### 3. GitHub App Integration

The system is installed as a GitHub App on the Ruby Taiwan organization with read-only permissions to access Project and Issues data, serving as the data source for daily summaries and interaction commands.

**User Journey:**

| Context                          | Action                                        | Outcome                                 |
| -------------------------------- | --------------------------------------------- | --------------------------------------- |
| System needs to access GitHub data | Authenticate via GitHub App and send API request | Retrieve latest Project and Issues data |

## Configuration

| Setting              | Description                                        | Default          |
| -------------------- | -------------------------------------------------- | ---------------- |
| Discord Channel ID   | Designated channel for summary delivery and message collection | (required, no default) |
| Summary Collection Hours | Collect Discord messages from the past N hours  | 24               |
| Summary Item Limit   | Maximum number of action items per summary         | 30               |
| Memory Entry Limit   | Maximum number of memory entries for Memory Tool   | 32               |

## System Boundary

| Aspect       | Inside System                                                                                                   | Outside System                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Responsibility | Data collection, two-phase AI summary generation, memory management, query responses                          | Discord server administration, GitHub project management |
| Interaction  | Receive Discord Interaction Webhook; call GitHub API and AI service; read channel message history; read/write persistent memory store | Discord user authentication; GitHub permission settings; Discord channel configuration |
| Control      | Summary schedule and content format; channel and collection hours configuration; memory entry limit             | Discord channel configuration; GitHub Project structure  |

## Behaviors

### Daily AI Summary

#### Data Collection

| State                              | Action                                              | Result                                                          |
| ---------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Scheduled time reached             | Trigger summary generation pipeline                 | System begins collecting data                                   |
| Discord message history collected  | Retrieve messages from designated channel within configured time window | Messages sorted by time; extract author, content, timestamp, attachments, mentions |

#### Phase 1: Conversation Grouping

| State                          | Action                                                                      | Result                                                                |
| ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Sorted message list received   | AI identifies existing action items from bot messages (previous summaries)  | Existing action items considered during grouping to avoid duplication  |
| Existing action items identified | AI groups messages by topic and context, tagging each group with attributes (community-related, small talk, lost context) | Topic group list produced, each with summary and attribute tags |
| Grouping complete              | AI may read/update cross-execution context memory via Memory Tool          | Memory assists grouping decisions; updated after processing for next run |
| Grouping complete              | AI may query Projects and Issues via GitHub Tool                           | GitHub data assists in determining whether messages relate to existing tasks |

#### Phase 2: Action Item Generation

| State                          | Action                                                                              | Result                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Topic group list received      | AI filters out non-community-related (`community-related=no`) and small talk (`small talk=yes`) groups | Only community-relevant groups retained                                 |
| Relevant groups filtered       | AI generates an action item for each group, classified as to-do, in-progress, done, stalled, or discussion | At most one action item per group, with assignee, task description, and reason |
| Action items generated         | AI may update memory via Memory Tool; may verify task status via GitHub Tool        | Memory and GitHub data assist action item status classification                |
| All action items generated     | Compile into action item list (capped by config), formatted as `- [Status] Description` | List sent to designated Discord channel for operators to read                |

### Discord Interaction Commands

| State                                | Action             | Result                                              |
| ------------------------------------ | ------------------ | --------------------------------------------------- |
| Discord Interaction Webhook received | Verify request signature | Process command if valid; reject request if invalid |

**To be decided:** Command behavior definitions (to be updated after Feature 2 decisions are finalized).

### GitHub App Integration

| State                    | Action                                       | Result                          |
| ------------------------ | -------------------------------------------- | ------------------------------- |
| GitHub data access needed | Use App credentials to obtain Installation Access Token | Obtain time-limited access token |
| Access Token valid       | Send GitHub API request                      | Retrieve requested data         |
| Access Token expired     | Re-obtain Installation Access Token          | Retry request with refreshed token |

## Error Scenarios

| Scenario                                          | System Behavior                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Discord message history collection fails          | Apply "exponential backoff retry"; after all retries fail, log error, do not send summary             |
| Discord API request fails (sending summary)       | Apply "exponential backoff retry"; permanent failure logged                                           |
| AI service fails to complete grouping or action item generation | Apply "exponential backoff retry"; after all retries fail, send raw message summary (without AI analysis) to Discord channel with error notice |
| Memory Tool read/write fails                      | Log warning; AI continues processing without memory assistance (degraded but not interrupted)         |
| GitHub Tool query fails (auth failure, rate limit) | Log warning; AI continues processing without GitHub data assistance (degraded but not interrupted)   |
| GitHub App authentication fails                   | Apply "exponential backoff retry"; after all retries fail, log error, GitHub Tool unavailable         |
| Interaction command timeout (platform time limit)  | Reply with timeout notice, suggest retrying later                                                    |

## Patterns

### Exponential Backoff Retry

When external service calls (GitHub API, Discord API, AI service) encounter transient failures, the system retries with exponential backoff, up to 3 attempts. After all retries fail, the failure is treated as permanent and handled according to the degradation behavior defined in each Error Scenario.

## Terminology

| Term               | Definition                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Summary            | Structured action item list produced by the two-phase AI pipeline                                    |
| Operator           | A member of the Ruby Taiwan core team responsible for community operations                            |
| Command            | A query request issued by an operator via Discord Slash Command                                      |
| Group              | Phase 1 output; aggregates contextually related conversation messages into a topic group with summary and attribute tags |
| Action Item        | Phase 2 output; a structured to-do extracted from a group, containing status, assignee, task description, and reason |
| Action Item Status | Classification label for action items: to-do, in-progress, done, stalled, or discussion              |
| Memory Tool        | An AI-accessible memory tool that stores and retrieves structured context memory for retaining information across executions |
| GitHub Tool        | An AI-accessible query tool that provides read-only access to GitHub Projects and Issues via GitHub App |
| Schedule           | The mechanism that triggers the summary generation pipeline on a timed basis, driven by platform scheduling |

## Contracts

| Interaction Point         | Contract                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Discord Interaction Webhook | System receives HTTP POST requests, verifies Ed25519 signature, processes commands, returns JSON response |
| GitHub API                | System makes read-only REST/GraphQL API calls using GitHub App Installation Token; also serves as the backend for AI GitHub Tool |
| Discord Bot API           | System sends messages to designated channel and reads channel message history via Bot Token           |
| AI Service                | System calls AI service in two phases: Phase 1 receives message list and produces groups; Phase 2 receives groups and produces action item list |
| Memory Store              | AI reads and writes structured memory entries via persistent key-value store; entry count capped by configuration |
| Cron Trigger              | Platform triggers summary generation pipeline on configured schedule                                  |
