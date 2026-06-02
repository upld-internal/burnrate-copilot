---
title: Monthly Records
parent: Developer Guide
nav_order: 6
---

# Monthly Records (JSONL Schema)

Completed sessions are stored as one JSON line per session in `~/.copilot/plugin-data/burnrate-copilot/monthly/YYYY-MM.jsonl`.

---

## File Location

```
~/.copilot/plugin-data/burnrate-copilot/monthly/
├── 2026-04.jsonl
├── 2026-05.jsonl
└── ...
```

Records are appended to the file matching `start_month`. A session that starts in May but ends in June still goes into `2026-05.jsonl`.

---

## Full Schema

```json
{
  "id": "session-uuid",
  "date": "2026-06-01",
  "start_month": "2026-06",

  "cost_usd": 0.069879750,
  "cost_pending": false,
  "cost_method": "ai_credits",

  "model": "claude-sonnet-4.6",
  "project": "my-app",
  "project_id": "-Users-bripley-Projects-my-app",

  "final_tokens": {
    "total_input_tokens": 85386,
    "total_output_tokens": 98,
    "total_cache_write_tokens": 12397,
    "total_cache_read_tokens": 72980
  },

  "jira_costs": { "PROJ-123": 0.05, "PROJ-456": 0.02 },
  "jira_key": "PROJ-123",
  "jira_source": "branch",
  "jira_keys_seen": ["PROJ-123", "PROJ-456"],

  "turn_count": 5,
  "tool_counts": { "bash": 12, "view": 8, "edit": 4 },
  "ext_counts": { ".js": 3, ".md": 1 },
  "subagent_count": 1,
  "subagent_types": { "explore": 1 },
  "turn_interval_p50_ms": 45000,
  "turn_interval_max_ms": 120000,
  "turn_interval_count": 4,
  "compaction_count": 0,
  "git_branch": "feature/auth",
  "prompt_count": 5,
  "prompt_length_p50_bytes": 312,
  "prompt_length_max_bytes": 820,
  "web_search_requests": 1,
  "tool_duration_p50_ms": 145,
  "tool_duration_max_ms": 2200,

  "turn_tokens": [
    { "turn": 1, "input": 1024,  "output": 312, "cache_write": 0,   "cache_read": 0     },
    { "turn": 2, "input": 18430, "output": 890, "cache_write": 1024, "cache_read": 16000 }
  ],

  "recovered": false
}
```

---

## Field Reference

### Core Fields (Always Present)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session UUID |
| `date` | string | ISO date when session ended |
| `start_month` | string | `YYYY-MM` — determines which file this record lives in |
| `cost_usd` | number | Total session cost in USD |
| `cost_pending` | boolean | `true` if no cost data was available (no-turn session) |
| `cost_method` | string | How cost was computed: `ai_credits`, `last_known`, `none` |
| `model` | string | Last-known model ID (e.g., `claude-sonnet-4.6`) |

### Project & Location

| Field | Type | Description |
|-------|------|-------------|
| `project` | string | Project name (basename of cwd) |
| `project_id` | string | Full path slug (e.g., `-Users-bripley-Projects-my-app`) |
| `git_branch` | string | Git branch at session start |

### Token Data

| Field | Type | Description |
|-------|------|-------------|
| `final_tokens` | object | Raw cumulative token totals at session end |

### Jira Attribution

| Field | Type | Description |
|-------|------|-------------|
| `jira_costs` | object | Map of Jira key → attributed cost USD |
| `jira_key` | string | Primary Jira ticket (highest cost) |
| `jira_source` | string | How the key was detected (`branch`) |
| `jira_keys_seen` | array | All Jira keys seen during the session |

### Telemetry

| Field | Type | Description |
|-------|------|-------------|
| `turn_count` | number | User prompts sent |
| `tool_counts` | object | Map of tool name → call count |
| `ext_counts` | object | Map of file extension → edit count |
| `turn_interval_p50_ms` | number | Median time between user prompts (ms) |
| `turn_interval_max_ms` | number | Longest gap between prompts (ms) |
| `turn_interval_count` | number | Number of measured intervals |
| `prompt_count` | number | Number of user prompts with non-empty text |
| `prompt_length_p50_bytes` | number | Median prompt byte length |
| `prompt_length_max_bytes` | number | Longest prompt byte length |
| `web_search_requests` | number | Web search tool calls (omitted when 0) |
| `web_fetch_requests` | number | Web fetch tool calls (omitted when 0) |
| `tool_duration_p50_ms` | number | Median tool execution time across all tools (ms) |
| `tool_duration_max_ms` | number | Slowest tool execution time (ms) |
| `turn_tokens` | array | Per-turn token breakdown: `{ turn, input, output, cache_write, cache_read }`, capped at 100 entries (omitted if no tokens exchanged) |

### Recovery

| Field | Type | Description |
|-------|------|-------------|
| `recovered` | boolean | `true` if written by orphan recovery (session didn't exit cleanly) |

---

## Querying Patterns

### Sum cost for current month

```javascript
const lines = fs.readFileSync(monthlyFile, 'utf8').split('\n');
const total = lines.filter(Boolean).reduce((sum, line) => {
  return sum + (JSON.parse(line).cost_usd || 0);
}, 0);
```

### Group by project

```javascript
const byProject = {};
for (const line of lines.filter(Boolean)) {
  const r = JSON.parse(line);
  byProject[r.project] = (byProject[r.project] || 0) + r.cost_usd;
}
```

### Find expensive sessions

```javascript
const expensive = records.filter(r => r.cost_usd > 1.00);
```

### Filter by cost method

```javascript
const orphans = records.filter(r => r.cost_method === 'last_known');
```

---

## Notes

- Fields are omitted (not set to null) when data is unavailable. Always check existence before access.
- `cost_method: "ai_credits"` is the normal case for sessions since the June 2026 AI Credits billing transition.
- `cost_method: "last_known"` occurs when a session exits without a final statusline fire (e.g. Ctrl+C before first turn completes).
- `cost_method: "none"` occurs for zero-turn sessions (cost is $0, which is correct — nothing was billed).
- `web_search_requests` and `web_fetch_requests` are only written when > 0.
- `prompt_count`/`prompt_length_*` are only written when at least one non-empty prompt was submitted.
- `tool_duration_p50_ms`/`tool_duration_max_ms` are only written when at least one tool round-trip completed.
- `turn_tokens` is only written when at least one StatusLine fire registered a non-zero token delta. Capped at the last 100 turns.
- `recovered: true` records may have less precise cost (depends on the session file state at crash time).
