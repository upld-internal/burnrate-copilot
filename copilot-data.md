# Copilot CLI Data Architecture

Reverse-engineered data flows, schemas, and available signals for cost tracking and usage analysis.
All findings are empirically verified from live data as of Copilot CLI 1.0.54.

---

## Directory Map

```
~/.copilot/
├── session-state/                     # Per-session workspace (THE GOLDMINE)
│   └── <session-id>/
│       ├── events.jsonl               # Full structured event stream (see below)
│       ├── session.db                 # Per-session SQLite (todos, inbox)
│       ├── workspace.yaml             # Session metadata (repo, branch, name)
│       ├── checkpoints/               # Context compaction checkpoints
│       │   ├── index.md               # Checkpoint history table
│       │   └── 001-<slug>.md          # Full checkpoint content
│       ├── rewind-snapshots/          # File backups before edits
│       │   ├── index.json             # Snapshot manifest with git state
│       │   └── backups/               # Actual file content backups
│       ├── files/                     # Persistent session artifacts
│       ├── research/                  # Research artifacts
│       └── vscode.metadata.json       # IDE origin metadata
├── session-store.db                   # Global session history (SQLite, FTS5)
├── burnrate-copilot/                  # Plugin data (see below)
│   ├── config.json                    # User display config
│   ├── pricing.json                   # Model pricing table (user override)
│   ├── sessions/<id>.json             # Live session state
│   ├── monthly/YYYY-MM.jsonl          # Completed session records
│   ├── debug/hooks.jsonl              # Hook debug log (COPILOT_HUD_DEBUG=1)
│   └── stdin-debug.jsonl              # StatusLine stdin log (COPILOT_HUD_DEBUG=1)
├── hud-state.json                     # Live tool/agent activity state
├── settings.json                      # Global Copilot settings
├── config.json                        # Managed config (plugins, experiments)
├── command-history-state.json         # Prompt history (commandHistory[])
├── permissions-config.json            # Per-project tool approvals
├── vscode.session.metadata.cache.json # IDE session metadata cache
├── logs/                              # Per-process log files
│   └── process-<timestamp>-<pid>.log  # Startup, errors, connection logs
├── hooks/                             # Plugin hook registrations
│   └── <plugin-name>.json             # Hook config per plugin
├── installed-plugins/                 # Cached plugin code
├── agents/                            # Custom agent definitions (.agent.md)
├── skills/                            # Custom skill definitions
├── plugin-data/                       # Per-plugin persistent storage
└── copilot-instructions.md            # User-level instructions
```

---

## events.jsonl — The Primary Data Source

**Location:** `~/.copilot/session-state/<session-id>/events.jsonl`
**Format:** One JSON object per line, append-only. Captures ALL session activity.

This is the richest data source available. It contains structured events for every action in the session, with parent-child relationships forming an event tree.

### Common fields (all event types)
| Field | Type | Description |
|---|---|---|
| `type` | string | Event type (see below) |
| `id` | uuid | Unique ID for this event |
| `parentId` | uuid\|null | Links to prior event (event tree) |
| `timestamp` | ISO-8601 | When this event occurred |
| `agentId` | string | Present on subagent events |

### Event Types

| `type` | Description |
|---|---|
| `session.start` | Session initialization with full context |
| `session.model_change` | Model or effort level change |
| `session.compaction_start` | Context compaction triggered (token breakdown) |
| `session.compaction_complete` | Compaction finished (tokens saved, checkpoint) |
| `session.context_changed` | Working directory/repo change mid-session |
| `session.plan_changed` | Plan file created/updated |
| `session.info` | Informational events (MCP connected, etc.) |
| `session.warning` | Non-fatal warnings (MCP timeout, etc.) |
| `session.shutdown` | **Session end with full model metrics** |
| `user.message` | User prompt text |
| `system.message` | System prompt content |
| `assistant.turn_start` | Turn begins (turnId, interactionId) |
| `assistant.message` | **Model response with outputTokens** |
| `assistant.turn_end` | Turn complete |
| `tool.execution_start` | Tool call initiated (name, args) |
| `tool.execution_complete` | **Tool finished with toolTelemetry** |
| `tool.user_requested` | User-initiated tool call (local_shell) |
| `hook.start` | Plugin hook fired (captures full hook input) |
| `hook.end` | Plugin hook completed (success/error) |
| `subagent.started` | **Subagent launched (name, model, description)** |
| `subagent.completed` | **Subagent done (totalTokens, durationMs, totalToolCalls)** |
| `skill.invoked` | Skill activation (name, path, content) |
| `abort` | User cancelled (reason: "user_initiated") |

---

### session.start
```json
{
  "type": "session.start",
  "data": {
    "sessionId": "uuid",
    "version": 1,
    "producer": "copilot-agent",
    "copilotVersion": "1.0.54",
    "startTime": "ISO-8601",
    "context": {
      "cwd": "/working/directory",
      "gitRoot": "/git/root",
      "branch": "main",
      "headCommit": "sha",
      "repository": "owner/repo",
      "hostType": "github",
      "repositoryHost": "github.com"
    },
    "alreadyInUse": false,
    "remoteSteerable": false
  }
}
```

---

### session.shutdown ⭐ KEY DATA SOURCE
```json
{
  "type": "session.shutdown",
  "data": {
    "shutdownType": "routine",
    "totalPremiumRequests": 146.16,
    "totalApiDurationMs": 2126547,
    "sessionStartTime": 1779660132715,
    "codeChanges": {
      "linesAdded": 3634,
      "linesRemoved": 119,
      "filesModified": ["path1", "path2", "..."]
    },
    "modelMetrics": {
      "<model-id>": {
        "requests": {
          "count": 129,
          "cost": 48
        },
        "usage": {
          "inputTokens": 12116761,
          "outputTokens": 76438,
          "cacheReadTokens": 10621575,
          "cacheWriteTokens": 1476728,
          "reasoningTokens": 0
        }
      }
    },
    "currentModel": "claude-opus-4.6",
    "currentTokens": 109349,
    "systemTokens": 9826,
    "conversationTokens": 82976,
    "toolDefinitionsTokens": 16543
  }
}
```
**Critical:** `modelMetrics` is a per-model breakdown including ALL usage (parent + subagents).
`requests.cost` is in premium request units (not USD). Multi-model sessions show every model separately.
`reasoningTokens` captures extended thinking usage.

---

### session.compaction_start
```json
{
  "type": "session.compaction_start",
  "data": {
    "systemTokens": 12760,
    "conversationTokens": 72337,
    "toolDefinitionsTokens": 49426
  }
}
```

---

### session.compaction_complete
```json
{
  "type": "session.compaction_complete",
  "data": {
    "success": true,
    "preCompactionTokens": 134523,
    "preCompactionMessagesLength": 111,
    "checkpointNumber": 1,
    "checkpointPath": "/path/to/checkpoint.md",
    "compactionTokensUsed": {
      "inputTokens": 137858,
      "outputTokens": 3275,
      "cacheReadTokens": 135252,
      "cacheWriteTokens": 0,
      "duration": 60574,
      "model": "claude-sonnet-4.6"
    },
    "summaryContent": "<full compaction summary text>"
  }
}
```
**Note:** `compactionTokensUsed` captures the token cost of the compaction itself (separate API call).

---

### session.model_change
```json
{
  "type": "session.model_change",
  "data": {
    "newModel": "claude-opus-4.6",
    "previousReasoningEffort": "high",
    "reasoningEffort": "high"
  }
}
```

---

### session.context_changed
```json
{
  "type": "session.context_changed",
  "data": {
    "cwd": "/new/working/dir",
    "gitRoot": "/new/git/root",
    "branch": "feature-branch",
    "headCommit": "sha",
    "repository": "owner/repo",
    "hostType": "github",
    "repositoryHost": "github.com"
  }
}
```

---

### assistant.message ⭐
```json
{
  "type": "assistant.message",
  "data": {
    "messageId": "uuid",
    "model": "claude-opus-4.6",
    "content": "text response (may be empty if only tool calls)",
    "toolRequests": [
      {
        "toolCallId": "toolu_bdrk_...",
        "name": "view",
        "arguments": { "path": "/file" },
        "type": "function",
        "intentionSummary": "view the file at /file."
      }
    ],
    "interactionId": "uuid",
    "turnId": "0",
    "outputTokens": 401,
    "requestId": "github-request-id",
    "serviceRequestId": "uuid",
    "reasoningOpaque": "<encrypted extended thinking>",
    "reasoningText": "<visible reasoning text>"
  }
}
```
**Key:** `outputTokens` gives per-message output token count.
`reasoningOpaque` presence indicates extended thinking was used.
`requestId` links to GitHub API logs.

---

### subagent.started ⭐
```json
{
  "type": "subagent.started",
  "data": {
    "toolCallId": "toolu_bdrk_...",
    "agentName": "rubber-duck",
    "agentDisplayName": "Rubber Duck Agent",
    "agentDescription": "A constructive critic...",
    "model": "gpt-5.5"
  },
  "agentId": "toolu_bdrk_..."
}
```

---

### subagent.completed ⭐
```json
{
  "type": "subagent.completed",
  "data": {
    "toolCallId": "toolu_bdrk_...",
    "agentName": "rubber-duck",
    "agentDisplayName": "Rubber Duck Agent",
    "model": "gpt-5.5",
    "totalToolCalls": 17,
    "totalTokens": 375820,
    "durationMs": 416707
  },
  "agentId": "toolu_bdrk_..."
}
```
**Key:** `totalTokens` is the complete token usage for that subagent run.
`durationMs` is wall-clock time. `totalToolCalls` shows agent activity level.
Combined with `model` field, enables per-subagent cost computation.

---

### tool.execution_start
```json
{
  "type": "tool.execution_start",
  "data": {
    "toolCallId": "toolu_bdrk_...",
    "toolName": "view",
    "arguments": { "path": "/file" },
    "turnId": "0"
  }
}
```

---

### tool.execution_complete ⭐
```json
{
  "type": "tool.execution_complete",
  "data": {
    "toolCallId": "toolu_bdrk_...",
    "model": "claude-opus-4.6",
    "interactionId": "uuid",
    "turnId": "0",
    "success": true,
    "result": {
      "content": "tool output text",
      "detailedContent": "longer version"
    },
    "toolTelemetry": {
      "properties": {
        "command": "view",
        "options": "{\"truncateBasedOn\":\"tokenCount\",\"truncateStyle\":\"middle\"}",
        "inputs": "[\"path\",\"command\"]",
        "resolvedPathAgainstCwd": "false",
        "fileExtension": "[\".js\"]",
        "viewType": "file",
        "largeOutputAvoided": "true",
        "largeOutputOriginalSizeBytes": "21640"
      },
      "metrics": {
        "resultLength": 148,
        "resultForLlmLength": 148,
        "responseTokenLimit": 42000
      },
      "restrictedProperties": {}
    }
  }
}
```
**Key:** `toolTelemetry` contains tool-specific metadata:
- `view`: viewType, fileExtension, largeOutputAvoided, resultLength
- `bash`: customTimeout, executionMode, detached, commandTimeout
- All: resultLength, resultForLlmLength, responseTokenLimit

---

### abort
```json
{
  "type": "abort",
  "data": {
    "reason": "user_initiated"
  }
}
```

---

## Hook Payloads

All hooks receive stdin as JSON. Copilot CLI v1.0.54 supports **14 hook types**:

### Full Hook Registry (from compiled source)
| Hook Name | Config Key | Status |
|---|---|---|
| SessionStart | `sessionStart` | ✅ Active in burnrate-copilot |
| SessionEnd | `sessionEnd` | ✅ Active |
| UserPromptSubmitted | `userPromptSubmitted` | ✅ Active |
| PreToolUse | `preToolUse` | ✅ Active |
| PostToolUse | `postToolUse` | ✅ Active |
| PreMcpToolCall | `preMcpToolCall` | ❌ Not used |
| PostToolUseFailure | `postToolUseFailure` | ❌ Not used |
| ErrorOccurred | `errorOccurred` | ❌ Not used |
| AgentStop | `agentStop` | ❌ Not used |
| SubagentStart | `subagentStart` | ❌ Not used |
| SubagentStop | `subagentStop` | ❌ Not used |
| PreCompact | `preCompact` | ❌ Not used |
| PermissionRequest | `permissionRequest` | ❌ Not used |
| Notification | `notification` | ❌ Not used |

---

### SessionStart (hook payload)
```json
{
  "sessionId": "uuid",
  "timestamp": 1779894068442,
  "cwd": "/working/directory",
  "source": "new | resume",
  "initialPrompt": "first user message text"
}
```
**Key:** `source` distinguishes new vs resumed sessions. `initialPrompt` gives the first prompt before processing.

---

### SessionEnd (hook payload)
```json
{
  "sessionId": "uuid",
  "timestamp": 1779391156635,
  "cwd": "/working/directory",
  "reason": "complete | error | ..."
}
```
**No cost or token data.** Must rely on session file or events.jsonl.

---

### UserPromptSubmitted (hook payload)
```json
{
  "sessionId": "uuid",
  "timestamp": 1779391169900,
  "cwd": "/working/directory",
  "prompt": "full user message text"
}
```

---

### PreToolUse (hook payload)
```json
{
  "sessionId": "uuid",
  "cwd": "/working/directory",
  "toolCalls": [
    {
      "id": "toolu_bdrk_...",
      "name": "bash",
      "args": "{\"command\":\"ls\",\"description\":\"List files\"}"
    },
    {
      "id": "toolu_bdrk_...",
      "name": "view",
      "args": "{\"path\":\"/file\"}"
    }
  ]
}
```
**Key difference from Claude Code:** `toolCalls` is an **array** — all parallel tool calls in a single turn arrive together. `args` is a JSON string (not parsed object).

---

### PostToolUse (hook payload)
```json
{
  "sessionId": "uuid",
  "timestamp": 1779795567001,
  "cwd": "/working/directory",
  "toolName": "report_intent",
  "toolArgs": {
    "intent": "Exploring both projects"
  },
  "toolResult": {
    "textResultForLlm": "Intent logged",
    "resultType": "success | failure | denied",
    "sessionLog": "Exploring both projects",
    "toolTelemetry": {}
  }
}
```
**Key:** `toolResult.resultType` gives success/failure. `toolResult.toolTelemetry` contains the same telemetry from events.jsonl. Called once per individual tool in the batch.

---

### SubagentStart (hook payload, not yet registered)
```json
{
  "sessionId": "uuid",
  "transcriptPath": "/path/to/parent/events.jsonl",
  "agentName": "rubber-duck",
  "agentDisplayName": "Rubber Duck Agent",
  "agentDescription": "A constructive critic..."
}
```

---

### SubagentStop (hook payload, not yet registered)
```json
{
  "sessionId": "uuid",
  "transcriptPath": "/path/to/parent/events.jsonl",
  "agentName": "rubber-duck",
  "agentDisplayName": "Rubber Duck Agent",
  "stopReason": "end_turn"
}
```
**Note:** Unlike `subagent.completed` in events.jsonl, the hook does NOT include `totalTokens` or `durationMs`. Those are only in events.jsonl.

---

### AgentStop (hook payload, not yet registered)
```json
{
  "timestamp": 1779894068442,
  "cwd": "/working/directory",
  "sessionId": "uuid",
  "transcriptPath": "/path/to/events.jsonl",
  "stopReason": "end_turn"
}
```
Fires when the main agent completes a response turn.

---

### PreCompact (hook payload, not yet registered)
Fires before context compaction. Payload not fully captured yet but events.jsonl `session.compaction_start` provides: `systemTokens`, `conversationTokens`, `toolDefinitionsTokens`.

---

### ErrorOccurred (hook payload, not yet registered)
Fires on non-fatal errors. Payload structure not yet captured from live data.

---

### PreMcpToolCall (hook payload, not yet registered)
Fires before MCP tool calls. Payload structure not yet captured from live data.

---

### PostToolUseFailure (hook payload, not yet registered)
Fires when a tool call fails. Payload structure not yet captured from live data.

---

### PermissionRequest (hook payload, not yet registered)
Fires when a tool requires permission approval. Payload structure not yet captured from live data.

---

### Notification (hook payload, not yet registered)
Fires on system notifications. Payload structure not yet captured from live data.

---

## StatusLine Payload

**Mechanism:** Copilot runs the configured `statusLine.command` on every turn, piping JSON to stdin.
**Config:** `~/.copilot/settings.json` → `"statusLine": { "type": "command", "command": "/path/to/statusline.js" }`

```json
{
  "session_id": "uuid",
  "model": {
    "id": "claude-opus-4.6",
    "display_name": "Claude Opus 4.6"
  },
  "context_window": {
    "context_window_size": 200000,
    "used_percentage": 35,
    "remaining_tokens": 130000,
    "total_input_tokens": 580816,
    "total_output_tokens": 2626,
    "total_cache_read_tokens": 516530,
    "total_cache_write_tokens": 64272,
    "last_call_input_tokens": 3200,
    "last_call_output_tokens": 820
  },
  "cost": {
    "total_api_duration_ms": 45000,
    "total_duration_ms": 300000,
    "total_premium_requests": 3,
    "total_lines_added": 42,
    "total_lines_removed": 5
  }
}
```
**Critical difference from Claude Code:** No `cost.total_cost_usd` field. Cost must be computed from the four token types. `total_premium_requests` is in premium request cost units (fractional for non-premium models).

`last_call_input_tokens` / `last_call_output_tokens` give per-turn token delta.

---

## burnrate-copilot Session File

**Location:** `~/.copilot/burnrate-copilot/sessions/<session-id>.json`
Written by SessionStart (zero baseline), updated every StatusLine turn.

```json
{
  "session_id": "uuid",
  "started_at": "ISO-8601",
  "start_month": "YYYY-MM",
  "model_id": "claude-opus-4.6",
  "project": "burnrate-copilot",
  "project_id": "-Users-bripley-Projects-burnrate-burnrate-copilot",
  "git_branch": "main",
  "snapshot": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_cache_write_tokens": 0,
    "total_cache_read_tokens": 0
  },
  "last_known_tokens": {
    "total_input_tokens": 580816,
    "total_output_tokens": 2626,
    "total_cache_write_tokens": 64272,
    "total_cache_read_tokens": 516530
  },
  "last_known_model": "claude-opus-4.6",
  "last_known_at": "ISO-8601",
  "last_known_cost": 3.629695,
  "last_known_project": "burnrate-copilot",
  "last_known_project_id": "-Users-bripley-Projects-burnrate-burnrate-copilot",
  "jira_costs": {
    "unattributed": 3.629695
  },
  "last_jira_cost_checkpoint": 3.629695,
  "tool_counts": {
    "view": 25,
    "bash": 4
  },
  "ext_counts": {
    ".js": 3,
    ".md": 2
  },
  "subagents": [
    { "type": "explore", "started_at": "ISO-8601" }
  ],
  "turn_count": 5,
  "turn_intervals": [12000, 45000, 8000],
  "last_prompt_at": 1779894178152
}
```

---

## burnrate-copilot Monthly Record

**Location:** `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`
One record per completed session, appended at SessionEnd or orphan recovery.

```json
{
  "id": "session-uuid",
  "date": "YYYY-MM-DD",
  "start_month": "YYYY-MM",
  "cost_usd": 102.93178775,
  "cost_pending": false,
  "model": "claude-opus-4.6",
  "project": "website",
  "project_id": "-Users-bripley-Projects-personal-website",
  "final_tokens": {
    "total_input_tokens": 16091871,
    "total_output_tokens": 110901,
    "total_cache_write_tokens": 2043919,
    "total_cache_read_tokens": 13850828
  },
  "recovered": true,
  "jira_costs": { "unattributed": 120.428977 },
  "jira_key": "PROJ-123",
  "jira_source": "branch",
  "jira_keys_seen": ["PROJ-123"],
  "turn_count": 29,
  "tool_counts": {
    "web_fetch": 52,
    "bash": 60,
    "view": 18,
    "create": 83
  },
  "ext_counts": { ".md": 45, ".js": 10 },
  "subagent_count": 3,
  "subagent_types": { "explore": 2, "general-purpose": 1 },
  "turn_interval_p50_ms": 877704,
  "turn_interval_max_ms": 74539980,
  "turn_interval_count": 28,
  "git_branch": "main"
}
```

---

## hud-state.json (Live Activity State)

**Location:** `~/.copilot/hud-state.json`
Written by hook scripts, read by statusline compositor. Tracks real-time tool/agent activity.

```json
{
  "sessionId": "uuid",
  "sessionStart": 1779894068442,
  "cwd": "/working/directory",
  "lastPrompt": "user message text",
  "lastPromptTime": 1779894090000,
  "recentTools": [
    {
      "name": "bash",
      "target": "npm test",
      "status": "running | success | failure | denied",
      "timestamp": 1779894178152
    }
  ],
  "agents": [
    {
      "description": "Research codebase patterns",
      "subagentType": "explore",
      "status": "running | success | failure",
      "startTime": 1779894100000,
      "endTime": 1779894200000
    }
  ],
  "sessionActive": true
}
```

---

## workspace.yaml (Per-Session Metadata)

**Location:** `~/.copilot/session-state/<session-id>/workspace.yaml`

```yaml
id: uuid
cwd: /working/directory
git_root: /git/root
repository: owner/repo
host_type: github
branch: main
name: Session Display Name
user_named: false
summary_count: 0
created_at: ISO-8601
updated_at: ISO-8601
```

---

## session-store.db (Global Session History)

**Location:** `~/.copilot/session-store.db`
SQLite database with FTS5 search. Contains all past session data.

### Schema
```sql
sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at)
turns (session_id, turn_index, user_message, assistant_response, timestamp)
checkpoints (session_id, checkpoint_number, title, overview, history, work_done,
             technical_details, important_files, next_steps)
session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
session_refs (session_id, ref_type, ref_value, turn_index, created_at)
search_index (FTS5: content, session_id, source_type, source_id)
dynamic_context_items (repository, branch, src, name, description, content, read_count, count)
```

---

## session.db (Per-Session SQLite)

**Location:** `~/.copilot/session-state/<session-id>/session.db`

```sql
todos (id, title, description, status, created_at, updated_at)
todo_deps (todo_id, depends_on)
inbox_entries (id, recipient_session_id, sender_id, sender_name, sender_type,
              interaction_id, sequence, summary, content, unread, sent_at, read_at, notified_at)
```

---

## Copilot Process Logs

**Location:** `~/.copilot/logs/process-<timestamp>-<pid>.log`
Text log with timestamps, log levels, and messages. Contains:
- Version info, Node.js version
- Authentication status
- MCP server connection events
- Plugin load status
- Session registration
- API errors with request IDs
- Memory/feature flags
- Uncaught exceptions

---

## Rewind Snapshots

**Location:** `~/.copilot/session-state/<session-id>/rewind-snapshots/`

### index.json
```json
{
  "version": 1,
  "snapshots": [
    {
      "snapshotId": "uuid",
      "eventId": "uuid",
      "userMessage": "full user prompt that triggered changes",
      "timestamp": "ISO-8601",
      "fileCount": 1,
      "gitCommit": "sha",
      "gitBranch": "main",
      "backupHashes": ["hash-timestamp"],
      "files": {
        "<file-hash>": {
          "gitStatus": " M",
          "contentHash": "git-sha1:hash",
          "backupFile": "hash-timestamp",
          "size": 15800,
          "mtime": "ISO-8601",
          "mode": 33188
        }
      }
    }
  ],
  "filePathMap": {
    "<file-hash>": "/absolute/file/path"
  }
}
```

---

## Data Gaps and Signals Not Yet Captured

### Currently missing from burnrate-copilot

| Signal | Source | Gap |
|---|---|---|
| **Per-model cost (multi-model sessions)** | `session.shutdown.modelMetrics` in events.jsonl | Not parsed — single-model assumption in statusline |
| **Subagent cost** | `subagent.completed.totalTokens` + model in events.jsonl | Not parsed from events.jsonl |
| **Compaction token cost** | `session.compaction_complete.compactionTokensUsed` | Not captured |
| **Per-turn output tokens** | `assistant.message.outputTokens` in events.jsonl | Not captured |
| **Reasoning tokens** | `session.shutdown.modelMetrics.*.usage.reasoningTokens` | Not captured |
| **Premium request cost** | `session.shutdown.modelMetrics.*.requests.cost` | Not captured |
| **Tool telemetry** | `tool.execution_complete.toolTelemetry` | Not captured |
| **Abort events** | `abort` in events.jsonl | Not tracked |
| **Model switches** | `session.model_change` in events.jsonl | Not tracked (cost attributed to last model) |
| **Files modified** | `session.shutdown.codeChanges.filesModified[]` | Not in monthly record |
| **Context window breakdown** | `session.shutdown.systemTokens/conversationTokens/toolDefinitionsTokens` | Not captured |
| **Subagent hooks** | `subagentStart`/`subagentStop` hook events | Not registered in hooks.json |
| **AgentStop hook** | `agentStop` hook event (per-turn completion) | Not registered |
| **PreCompact hook** | `preCompact` hook event | Not registered |
| **Error tracking** | `errorOccurred` hook + session.warning events | Not registered |
| **MCP tool calls** | `preMcpToolCall` hook | Not registered |
| **Inter-message timing (AI-only)** | Computed from turn_start → turn_end in events.jsonl | Only have combined user+AI time |
| **Session duration (precise)** | `session.shutdown.sessionStartTime` → `shutdown.timestamp` | Approximated from started_at |

### Optimize skill opportunities from uncaptured data

- **Per-model cost breakdown** — `modelMetrics` in shutdown event enables "which model is costing most" analysis
- **Subagent cost attribution** — `subagent.completed` with `totalTokens` + `model` enables per-agent cost
- **Compaction cost tracking** — compaction API calls have their own token cost not reflected in statusline totals
- **Token efficiency ratio** — `outputTokens` per turn vs `cacheReadTokens` shows reuse efficiency
- **Reasoning token premium** — `reasoningTokens > 0` identifies extended thinking usage (higher cost)
- **Tool failure rate** — `toolResult.resultType` in postToolUse tracks error patterns
- **Tool execution patterns** — `toolTelemetry.metrics.resultLength` shows context bloat from large tool outputs
- **Model switch patterns** — frequent model changes in a session may indicate auto-routing or user indecision
- **Context pressure** — `compaction_start` token breakdown shows what fills the context window
- **Abort rate** — sessions with `abort` events indicate user frustration or misdirection
- **Premium request budgeting** — `totalPremiumRequests` in shutdown enables quota tracking

### Key Architectural Differences from Claude Code

| Dimension | Claude Code | Copilot CLI |
|---|---|---|
| Transcript format | Session JSONL (`~/.claude/projects/`) | events.jsonl in session-state |
| Subagent transcripts | Separate JSONL files per agent | Inline events with `agentId` field |
| Cost source | `cost.total_cost_usd` in StatusLine | Must compute from tokens × pricing |
| Token field names | `cache_creation_input_tokens` | `total_cache_write_tokens` |
| Hook dispatch | Individual tool per hook call | PreToolUse sends `toolCalls[]` array |
| Model identifier | `us.anthropic.claude-sonnet-4-6` | `claude-sonnet-4.6` |
| Session shutdown data | None (no token data at SessionEnd) | **Rich modelMetrics in events.jsonl** |
| Subagent completion | Must parse JSONL transcript | `subagent.completed` event has `totalTokens` |
| Compaction cost | Not available | `compactionTokensUsed` in events.jsonl |
| Premium requests | Not applicable (direct billing) | `totalPremiumRequests` (quota-based) |

---

## Recommended Next Steps

1. **Register subagentStart/subagentStop hooks** — captures subagent lifecycle in real-time
2. **Parse events.jsonl at SessionEnd** — extract `session.shutdown.modelMetrics` for accurate multi-model cost
3. **Track subagent.completed events** — `totalTokens` + `model` enables per-subagent cost
4. **Register preCompact hook** — bank cost before compaction to avoid undercount
5. **Register agentStop hook** — enables per-turn timing without events.jsonl parsing
6. **Add `reasoningTokens` to pricing** — extended thinking uses different rates on some providers
7. **Monthly record enrichment** — add `files_modified`, `model_metrics`, `premium_requests`
