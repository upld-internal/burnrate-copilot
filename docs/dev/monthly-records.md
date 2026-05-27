# Monthly Records (JSONL Schema)

Completed sessions are stored as one JSON line per session in `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`.

---

## File Location

```
~/.copilot/burnrate-copilot/monthly/
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
  "date": "2026-05-20",
  "start_month": "2026-05",

  "cost_usd": 14.438927,
  "cost_pending": false,
  "cost_method": "multi_model",

  "model": "claude-sonnet-4.6",
  "project": "my-app",
  "project_id": "-Users-bripley-Projects-my-app",

  "final_tokens": {
    "total_input_tokens": 3867120,
    "total_output_tokens": 28931,
    "total_cache_write_tokens": 256942,
    "total_cache_read_tokens": 3576001
  },

  "model_metrics": {
    "claude-sonnet-4.6": {
      "cost": 12.45,
      "hasPricing": true,
      "tokens": { "input": 3725610, "output": 25630, "cache_write": 256942, "cache_read": 3467457 },
      "requests": 50
    },
    "gpt-5.5": {
      "cost": 1.99,
      "hasPricing": true,
      "tokens": { "input": 141510, "output": 3301, "cache_write": 0, "cache_read": 108544 },
      "requests": 5
    }
  },

  "subagents_detail": [
    { "name": "explore", "model": "claude-haiku-4.5", "tokens": 500000, "cost_usd": 0.62, "duration_ms": 60000, "tool_calls": 20 },
    { "name": "gsd-executor", "model": "claude-sonnet-4.6", "tokens": 3000000, "cost_usd": 9.43, "duration_ms": 400000, "tool_calls": 80 }
  ],

  "compaction_cost": {
    "count": 2,
    "total_cost_usd": 0.98,
    "compactions": [
      { "model": "claude-sonnet-4.6", "input_tokens": 131504, "output_tokens": 2706, "cost_usd": 0.47, "duration_ms": 8500 }
    ]
  },

  "jira_costs": { "PROJ-123": 10.25, "PROJ-456": 4.19 },
  "jira_key": "PROJ-123",
  "jira_source": "branch",
  "jira_keys_seen": ["PROJ-123", "PROJ-456"],

  "turn_count": 29,
  "tool_counts": { "bash": 60, "view": 18, "edit": 12, "create": 5 },
  "ext_counts": { ".js": 10, ".md": 5, ".json": 2 },
  "subagent_count": 3,
  "subagent_types": { "explore": 2, "general-purpose": 1 },
  "turn_interval_p50_ms": 45000,
  "turn_interval_max_ms": 300000,
  "turn_interval_count": 28,
  "compaction_count": 2,
  "git_branch": "feature/auth",

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
| `cost_pending` | boolean | `true` if cost could not be computed (missing pricing) |
| `cost_method` | string | How cost was computed: `multi_model`, `model_tokens`, `single_model`, `last_known` |
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
| `model_metrics` | object | Per-model cost breakdown (from Strategy 1 or 2) |

### Subagent Data

| Field | Type | Description |
|-------|------|-------------|
| `subagents_detail` | array | Per-subagent cost/token/duration breakdown (from events.jsonl) |
| `subagent_count` | number | Total subagents spawned |
| `subagent_types` | object | Map of agent type → count |

### Compaction Data

| Field | Type | Description |
|-------|------|-------------|
| `compaction_cost` | object | Per-compaction breakdown (informational, already included in cost_usd) |
| `compaction_count` | number | Number of compactions in the session |

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

### Find sessions with high subagent cost

```javascript
const expensive = records.filter(r =>
  r.subagents_detail && r.subagents_detail.some(s => s.cost_usd > 5)
);
```

### Model mix analysis

```javascript
const modelCosts = {};
for (const r of records) {
  if (r.model_metrics) {
    for (const [model, data] of Object.entries(r.model_metrics)) {
      modelCosts[model] = (modelCosts[model] || 0) + data.cost;
    }
  }
}
```

---

## Notes

- Fields are omitted (not set to null) when data is unavailable. Always check existence before access.
- `cost_method: "multi_model"` records have `model_metrics`. Other methods may not.
- `subagents_detail` is only present when events.jsonl contains `subagent.completed` events.
- `compaction_cost` is only present when the session had compactions with `compactionTokensUsed` data.
- `recovered: true` records may have less accurate cost (depend on whatever data was in the session file at crash time).
