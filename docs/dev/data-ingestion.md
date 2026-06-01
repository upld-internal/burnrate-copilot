# Data Ingestion

All data consumed by burnrate-copilot comes from three sources, listed from richest to simplest.

---

## 1. events.jsonl (Post-Session Analysis)

**Location:** `~/.copilot/session-state/<session-id>/events.jsonl`

The authoritative record of everything that happened in a session. Append-only JSONL file written by Copilot CLI throughout the session. Used at session end for accurate multi-model cost.

### Key Events We Extract

| Event Type | Key Fields | Used For |
|---|---|---|
| `session.shutdown` | `modelMetrics` (per-model token breakdown) | Multi-model cost (Strategy 1) |
| `subagent.completed` | `totalTokens`, `model`, `durationMs`, `totalToolCalls` | Per-subagent cost attribution |
| `session.compaction_complete` | `compactionTokensUsed.{inputTokens, outputTokens, cacheReadTokens, model}` | Compaction cost breakdown |

### `session.shutdown.modelMetrics` (Most Important)

```json
{
  "claude-sonnet-4.6": {
    "requests": { "count": 283, "cost": 32 },
    "usage": {
      "inputTokens": 28955974,
      "outputTokens": 137975,
      "cacheReadTokens": 26888308,
      "cacheWriteTokens": 2051815,
      "reasoningTokens": 0
    }
  },
  "gpt-5.3-codex": {
    "requests": { "count": 15, "cost": 2 },
    "usage": { "inputTokens": 2649454, "outputTokens": 15016, ... }
  }
}
```

**Critical facts:**
- `modelMetrics` INCLUDES subagent tokens (they're not separate)
- `modelMetrics` INCLUDES compaction tokens (they're not additive)
- `requests.cost` is in "premium request" units, NOT USD
- Multi-model sessions get separate entries per model

### Events Not Currently Parsed (Available for Future Use)

| Event Type | Potential Use |
|---|---|
| `assistant.message` | Per-turn output token counts, reasoning token detection |
| `tool.execution_complete` | Tool telemetry (result sizes, execution modes) |
| `session.model_change` | Model switch tracking |
| `abort` | User frustration / cancellation rate |
| `session.compaction_start` | Pre-compaction context breakdown |

---

## 2. StatusLine Stdin (Real-Time, Every Turn)

**Mechanism:** Copilot runs the `statusLine.command` (configured in `~/.copilot/settings.json`) on every assistant turn, piping a JSON payload to stdin.

```json
{
  "session_id": "uuid",
  "session_name": "feature-auth",
  "cwd": "/Users/you/projects/my-app",
  "model": {
    "id": "claude-sonnet-4.6",
    "display_name": "claude-sonnet-4.6 (3x) (high)"
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
    "total_premium_requests": 3.0,
    "total_lines_added": 42,
    "total_lines_removed": 5
  }
}
```

### Key Properties

| Field | Notes |
|---|---|
| `total_input_tokens` | **Cumulative** — session lifetime, includes subagents, survives compaction |
| `total_output_tokens` | Same — cumulative, never resets |
| `total_cache_read_tokens` | Cumulative cache hits |
| `total_cache_write_tokens` | Cumulative cache storage |
| `model.id` | The **currently active** model (may change mid-session) |
| `used_percentage` | Context window fill level (0–100) |
| `total_premium_requests` | Fractional premium request count |
| `last_call_input_tokens` | Per-turn delta (this turn only) |

**Key field:** `ai_used.total_nano_aiu` — GitHub's authoritative billing figure. Cost in USD = `nano_aiu / 100_000_000_000`. No pricing table needed.

**Critical fact:** Token totals are cumulative across compactions. They never reset. Our delta calculation `(current - snapshot)` is always correct.

---

## 3. Hook Payloads (Lifecycle Events)

Copilot CLI fires hooks at specific lifecycle points. Each hook receives a JSON payload on stdin. We register 8 hooks in `hooks.json`.

### Hook Registry

| Hook | Fires When | Key Data |
|------|-----------|----------|
| `sessionStart` | Session opens (new or resumed) | `sessionId`, `cwd`, `source`, `initialPrompt` |
| `userPromptSubmitted` | User sends a message | `sessionId`, `cwd`, `prompt`, `timestamp` |
| `preToolUse` | Before tool execution | `sessionId`, `cwd`, `toolCalls[]` (array of all parallel calls) |
| `postToolUse` | After tool completes | `sessionId`, `toolName`, `toolArgs`, `toolResult.resultType` |
| `subagentStart` | Subagent spawned | `sessionId`, `agentName`, `agentDisplayName`, `transcriptPath` |
| `subagentStop` | Subagent finished | `sessionId`, `agentName`, `stopReason`, `transcriptPath` |
| `preCompact` | Before context compaction | `sessionId`, `systemTokens`, `conversationTokens`, `toolDefinitionsTokens` |
| `sessionEnd` | Session closes | `sessionId`, `cwd`, `reason`, `timestamp` |

### Hooks We Don't Register (Available)

| Hook | Potential Use |
|------|--------------|
| `agentStop` | Per-turn completion timing |
| `preMcpToolCall` | MCP tool tracking |
| `postToolUseFailure` | Error rate tracking |
| `errorOccurred` | Error telemetry |
| `permissionRequest` | Permission flow tracking |
| `notification` | System notification capture |

### Important Hook Behaviors

1. **`preToolUse` sends an array.** All parallel tool calls arrive in one invocation as `toolCalls[]`. This differs from Claude Code which fires once per tool.
2. **`subagentStop` does NOT include token data.** Unlike `subagent.completed` in events.jsonl, the hook payload only has `agentName` and `stopReason`. Token totals must come from events.jsonl.
3. **`sessionEnd` has NO cost data.** Only `sessionId` and `reason`. All cost must be pre-computed from the session file or events.jsonl.
4. **Hook timeout is 5 seconds.** Scripts must exit within this window or Copilot kills them.
5. **`model.id` is NOT available in `sessionStart`.** Only the statusline provides the model. This is why `session-start.js` records `model_id: ''` and the compositor fills it in on the first turn.

---

## Data Availability by Session Exit Type

| Exit Type | StatusLine data | Session file | events.jsonl | `session.shutdown` |
|-----------|:-:|:-:|:-:|:-:|
| Normal exit | ✅ | ✅ | ✅ | ✅ |
| `/exit` command | ✅ | ✅ | ✅ | ✅ |
| Ctrl+C | ✅ (last turn) | ✅ | ✅ (partial) | ❌ |
| Process crash | ✅ (last turn) | ✅ | ✅ (partial) | ❌ |
| System kill | ❌ | ✅ (if flushed) | ❌ | ❌ |

This is why the fallback chain exists — see [Cost Calculation](./cost-calculation.md).
