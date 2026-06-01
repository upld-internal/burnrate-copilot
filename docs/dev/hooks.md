# Hook Scripts

Each hook fires at a specific point in the Copilot CLI session lifecycle. Hook scripts receive JSON on stdin, must write nothing to stdout, and must exit within 5 seconds.

---

## Registration

All hooks are registered in `hooks.json` at the plugin root:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart":       [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-start.js",  "timeoutSec": 5 }],
    "userPromptSubmitted":[{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/user-prompt.js",    "timeoutSec": 5 }],
    "preToolUse":         [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/pre-tool-use.js",   "timeoutSec": 5 }],
    "postToolUse":        [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/post-tool-use.js",  "timeoutSec": 5 }],
    "subagentStart":      [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/subagent-start.js", "timeoutSec": 5 }],
    "subagentStop":       [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/subagent-stop.js",  "timeoutSec": 5 }],
    "preCompact":         [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/pre-compact.js",    "timeoutSec": 5 }],
    "sessionEnd":         [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-end.js",    "timeoutSec": 5 }]
  }
}
```

`${PLUGIN_ROOT}` is resolved by Copilot CLI at hook execution time.

---

## session-start.js

**Fires:** When a Copilot CLI session opens (new or resumed).

**Stdin:**
```json
{
  "sessionId": "uuid",
  "timestamp": 1779894068442,
  "cwd": "/working/directory",
  "source": "new | resume",
  "initialPrompt": "first user message text"
}
```

**What it does:**
1. Creates session file at `~/.copilot/burnrate-copilot/sessions/<id>.json`
2. Initializes zero `snapshot` (baseline for token delta)
3. Initializes `model_tokens: {}` for multi-model tracking
4. Captures `git_branch` via `git branch --show-current`
5. Runs **orphan recovery** — finds stale session files from crashed sessions, computes their cost, writes monthly records
6. Calls `ensureStatusLineConfig()` to auto-configure `settings.json` on first install
7. Writes `hud-state.json` with `sessionActive: true`

**Note:** `model.id` is NOT available in sessionStart. The model is recorded on the first statusline turn.

---

## user-prompt.js

**Fires:** When the user submits a message.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "timestamp": 1779391169900,
  "cwd": "/working/directory",
  "prompt": "full user message text"
}
```

**What it does:**
1. Increments `turn_count` in session file
2. Records timestamp in `turn_intervals[]` array (for P50/max interval computation)
3. Stores `last_prompt_at` timestamp
4. Appends `prompt.length` to `session.prompt_lengths[]` (for prompt length stats)
5. Updates `hud-state.json` with `lastPrompt` and `lastPromptTime`

---

## pre-tool-use.js

**Fires:** Before tool execution. Receives ALL parallel tool calls in one invocation.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "cwd": "/working/directory",
  "toolCalls": [
    { "id": "toolu_bdrk_...", "name": "bash", "args": "{\"command\":\"ls\"}" },
    { "id": "toolu_bdrk_...", "name": "view", "args": "{\"path\":\"/file\"}" }
  ]
}
```

**What it does:**
1. Accumulates `tool_counts` in session file (tool name → call count)
2. Detects `task` tool calls to track subagent spawning (`subagent_count`, `subagent_types`)
3. Extracts agent type from task tool args for `subagent_types` map
4. For `edit`/`create` tools: extracts file extension, increments `ext_counts` map
5. Increments `web_search_requests` / `web_fetch_requests` for web tool calls
6. Pushes a FIFO start-time entry to `session.tool_start_times[toolName][]` for duration tracking
7. Updates `hud-state.json` with `recentTools[]` (status: "running")

**Note:** When `subagentStart` hook fires for the same agent, `pre-tool-use.js` skips redundant tracking to avoid double-counting.

---

## post-tool-use.js

**Fires:** After a single tool completes. Called once per tool (not batched).

**Stdin:**
```json
{
  "sessionId": "uuid",
  "timestamp": 1779795567001,
  "cwd": "/working/directory",
  "toolName": "edit",
  "toolArgs": { "path": "/src/auth.js", "old_str": "...", "new_str": "..." },
  "toolResult": {
    "textResultForLlm": "File edited successfully",
    "resultType": "success | failure | denied",
    "sessionLog": "...",
    "toolTelemetry": { ... }
  }
}
```

**What it does:**
1. Pops the oldest entry from `session.tool_start_times[toolName][]` (FIFO) and computes `duration = timestamp - startTime`; appends to `session.tool_durations_ms[]`. Durations > 5 min are discarded (stale state guard).
2. Updates `hud-state.json` tool status (success/failure/denied)
3. Records tool target (file path or command) for `tool_activity` widget

---

## subagent-start.js

**Fires:** When a subagent is launched.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "transcriptPath": "/path/to/parent/events.jsonl",
  "agentName": "rubber-duck",
  "agentDisplayName": "Rubber Duck Agent",
  "agentDescription": "A constructive critic..."
}
```

**What it does:**
1. Appends agent info to `subagents[]` in session file
2. Increments `subagent_count`
3. Updates `subagent_types` map
4. Adds agent to `hud-state.json` `agents[]` (status: "running")

---

## subagent-stop.js

**Fires:** When a subagent completes.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "transcriptPath": "/path/to/parent/events.jsonl",
  "agentName": "rubber-duck",
  "agentDisplayName": "Rubber Duck Agent",
  "stopReason": "end_turn"
}
```

**What it does:**
1. Updates matching agent in `hud-state.json` `agents[]` (status: "success", sets endTime)
2. Records stop reason

**Note:** This hook does NOT provide `totalTokens` or `durationMs`. Those are only in `subagent.completed` events in events.jsonl.

---

## pre-compact.js

**Fires:** Before context compaction is performed.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "systemTokens": 11614,
  "conversationTokens": 106382,
  "toolDefinitionsTokens": 16845,
  "timestamp": 1779900000000
}
```

**What it does:**
1. Increments `compaction_count` in session file
2. Records context size breakdown (what was filling the context window)

**Important:** Statusline tokens are cumulative across compactions — they never reset. This hook is purely for telemetry; no "banking" is needed.

---

## session-end.js

**Fires:** When a session closes normally.

**Stdin:**
```json
{
  "sessionId": "uuid",
  "timestamp": 1779391156635,
  "cwd": "/working/directory",
  "reason": "complete | error"
}
```

**What it does:**
1. Reads session file
2. Computes final cost via 4-level fallback (see [Cost Calculation](./cost-calculation.md))
3. Parses events.jsonl for `subagents_detail` and `compaction_cost`
4. Detects Jira attribution from session state
5. Builds telemetry fields (turn_count, tool_counts, ext_counts, turn_intervals, prompt stats, web counts, tool duration stats, turn_tokens)
6. Appends complete JSONL record to `monthly/YYYY-MM.jsonl`
7. Deletes the session file (no longer needed)
8. Sets `sessionActive: false` in `hud-state.json`

This is the most complex hook — it finalizes all session data into the permanent record.
