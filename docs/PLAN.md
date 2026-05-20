# copilot-hud — Feature Parity Plan

This plan brings `burnrate-copilot` up to parity with `burnrate-claude`, which received three major feature areas since the Copilot version was last synced: Jira cost attribution, rich session telemetry, and three skills (`burnrate-cost-summary`, `burnrate-optimize`, `burnrate-report`). Two supporting additions — auto-configure statusLine and a docs folder — round out the work.

---

## Status: What's Already Done

### ✅ Phases 1–5 (original build)
- Plugin skeleton, session lifecycle (start/end), hooks.json
- Full widget compositor (powerline + plain), config system
- Widgets: `model_name`, `session_duration`, `session_name`, `lines_changed`, `context_window`, `premium_requests`, `token_breakdown`, `output_speed`, `last_call`, `cache_breakdown`, `git_branch`, `git_status`, `cwd`, `custom_*`, `separator`, `newline`
- Tool and agent activity tracking (tools widget, state.js, pre/post-tool-use hooks)
- Commands: `configure.md`, `setup.md`

### ✅ Phase 6 (cost calculation)
- `scripts/pricing.js` — `computeCost`, `getMtdAndProjected`, `loadPricing`
- `pricing.json` — GitHub Copilot AI Credits rates for all supported models (Claude, OpenAI, Google, GitHub fine-tuned)
- `scripts/compositor.js` — token-delta cost computation (Copilot field names: `total_cache_write_tokens`, `total_cache_read_tokens`)
- `scripts/session-end.js` — appends cost record to monthly JSONL
- `scripts/session-start.js` — snapshot baseline, orphan recovery

---

## ✅ Phase 0 — Docs Folder

Mirror the `burnrate-claude` docs structure so both projects have consistent reference material.

**New files:**

| File | Purpose |
|---|---|
| `docs/PLAN.md` | This file — implementation plan and phase tracker |
| `docs/data-points.md` | Catalog of every data point captured — source, hook, what it enables, optimize relevance |
| `docs/quick-start.md` | User-facing install guide, skill descriptions, config reference |

**Validation:**
- `docs/` directory exists with all three files present
- `data-points.md` covers at minimum: `cost_usd`, `model`, `project`, `duration_secs`, `input_tokens`/`output_tokens`, `jira_key`/`jira_costs` (once Phase 1 lands), and each telemetry field (once Phase 2 lands)
- `quick-start.md` documents all three skills and the `statusLine` config block

---

## Phase 1 — Jira Integration

**Goal:** Detect the active Jira ticket from the git branch name on every statusline turn. Track cost attribution per ticket across context switches within a session. Expose a `jira_ticket` widget and include Jira fields in the monthly JSONL record.

**Entry criteria:** Phase 6 complete ✅

**Design decisions:**
- Jira key is detected from `git branch --show-current` on each statusline turn — no hook needed.
- When the branch key changes mid-session, subsequent cost deltas are attributed to the new key.
- `config.jira.project_keys` (optional array) filters detection to known project prefixes; falls back to broad `[A-Z]+-\d+` pattern when absent.
- `jira_ticket` widget renders as a clickable OSC 8 hyperlink pointing to the configured Atlassian base URL.
- Copilot cost source is `sessionData.sessionCost` (computed from token delta × pricing); Claude uses `nativeCost` (provided by Claude Code). The `applyJiraDelta` call uses `sessionData.sessionCost` unchanged.

### New files

| File | Purpose |
|---|---|
| `scripts/jira-detector.js` | `extractJiraKey(text, projectKeys)`, `detectJiraKey(cwd, projectKeys)` — pure copy from Claude version (uses only git, no AI-specific deps) |
| `scripts/jira-attribution.js` | `applyJiraDelta`, `selectPrimaryJiraKey`, `normalizeJiraCosts` — pure copy (pure math/object logic) |
| `scripts/widgets/jira.js` | `jira_ticket` widget — copy from Claude version; confirm OSC 8 link uses configurable base URL |
| `tests/jira-detector.test.js` | Unit tests for `extractJiraKey` and `detectJiraKey` |
| `tests/jira-attribution.test.js` | Unit tests for `applyJiraDelta`, `selectPrimaryJiraKey`, `normalizeJiraCosts` |
| `tests/jira-widget.test.js` | Widget render tests and compositor integration |

### Modified files

| File | Change |
|---|---|
| `scripts/compositor.js` | `require('./jira-detector')`, `require('./jira-attribution')`; add `jiraKey`, `jiraSource`, `lastKnownJiraKey`, `lastKnownJiraSource` to `loadSessionData`; call `detectJiraKey` using `config.jira.project_keys`; call `applyJiraDelta(sessionRaw, sd.sessionCost, sd.lastKnownJiraKey)` in write-back block; write `last_known_jira_key` and `last_known_jira_source` back to session file |
| `scripts/session-end.js` | Include `jira_costs`, `jira_key`, `jira_source`, `jira_keys_seen` in JSONL record using same pattern as Claude version |
| `scripts/session-start.js` | Include Jira fields (`jira_costs`, `jira_key`) in orphan recovery records when present in session file |
| `scripts/widgets/index` (compositor.js WIDGETS map) | Register `jira_ticket` from `./widgets/jira` |

### Session file additions

```json
{
  "jira_key": "PLAT-4821",
  "jira_source": "branch",
  "last_known_jira_key": "PLAT-4821",
  "last_known_jira_source": "branch",
  "jira_costs": { "PLAT-4821": 0.082341 },
  "last_jira_cost_checkpoint": 0.082341,
  "jira_keys_seen": ["PLAT-4821"]
}
```

### JSONL record additions

```json
{
  "jira_key": "PLAT-4821",
  "jira_source": "branch",
  "jira_costs": { "PLAT-4821": 0.082341 },
  "jira_keys_seen": ["PLAT-4821"]
}
```

### Tests

Use `node:test` (no external deps). Mirror the Claude test suite structure.

**`tests/jira-detector.test.js`:**
- `extractJiraKey` — matches configured keys, rejects non-configured, uses broad fallback when keys absent
- `detectJiraKey` — detects key from git branch, returns null for non-git dir, returns null when branch has no matching key

**`tests/jira-attribution.test.js`:**
- `normalizeJiraCosts` — keeps only positive numeric values, rounds to 6dp
- `applyJiraDelta` — first delta attributed to current key; branch-change attributes subsequent delta to new key; null key → unattributed bucket; negative delta clamped to 0
- `selectPrimaryJiraKey` — returns highest-cost key; tie-breaks by last-known key; returns null when all keys are unattributed

**`tests/jira-widget.test.js`:**
- Returns null when no jira key present
- Renders key as plain text
- Renders source icon when `show_source: true`
- Renders OSC 8 hyperlink by default; disabled when `link: false`
- Compositor integration: jira_ticket segment appears in rendered output when session has a key

### Verification

```bash
# All tests pass
node tests/jira-detector.test.js
node tests/jira-attribution.test.js
node tests/jira-widget.test.js

# Manual: check out a branch with a Jira key in its name, run a session,
# verify the jira_ticket widget appears in the statusline output
```

---

## ✅ Phase 2 — Rich Session Telemetry

**Goal:** Add per-session telemetry fields to monthly JSONL records: tool call counts, edited file extension counts, prompt/response timing, and basic subagent tracking. Refactor session file writes to use atomic temp-rename to prevent partial writes on concurrent hook execution.

**Entry criteria:** Phase 1 complete

**Design decisions:**
- Introduce `scripts/session-file.js` as a shared helper so all hook scripts use the same atomic write path. Existing hooks (`session-start.js`, `session-end.js`, `pre-tool-use.js`, `post-tool-use.js`, `user-prompt.js`) are updated to import from it.
- **No `Stop` hook in Copilot CLI.** Turn counting uses `userPromptSubmitted` as a proxy (each prompt submitted = one turn started). This counts turns conservatively (misses autonomous sub-turns) but is reliable.
- **No `SubagentStart/Stop` hooks.** Subagent tracking remains as-is via the `task` tool in `pre-tool-use.js`, but is not promoted to JSONL telemetry in this phase.
- **No `PreCompact/PostCompact` or `InstructionsLoaded` hooks.** Those fields are Claude Code-specific and are not included.
- The existing `pre-tool-use.js` and `post-tool-use.js` write to `state.json` for the live tools widget. Phase 2 adds a *secondary* write to the session JSON file for JSONL telemetry — both writes are preserved.
- Field names in Copilot hook payloads use camelCase: `toolName`, `toolInput` (vs Claude's `tool_name`, `tool_input`).
- `logHookDebug` activates when `COPILOT_HUD_DEBUG=1` is set; writes to `~/.copilot/copilot-hud/debug/hooks.jsonl`.

### New files

| File | Purpose |
|---|---|
| `scripts/session-file.js` | `updateSession(id, fn)` — atomic read/mutate/write; `buildTelemetryFields(session)` — extracts JSONL fields; `logHookDebug(event, data, id)` — debug logger. Adapted from Claude version: use `getCopilotConfigDir`, `DATA_DIR_NAME = 'copilot-hud'`; remove Claude-specific fields (`compaction_triggers`, `instruction_files`, `has_project_claude_md`). |
| `scripts/session-posttooluse.js` | PostToolUse: accumulates `ext_counts` for Edit/Write file operations. Note Copilot field name: `toolInput.file_path` (from `toolInput`, not `tool_input`). |
| `scripts/session-promptsubmit.js` | userPromptSubmitted: increments `turn_count` and records `last_prompt_at` timestamp. Also used for response time: when `last_prompt_at` is set and this hook fires again, compute elapsed ms as the previous response time. |
| `tests/telemetry.test.js` | Integration tests that run hook scripts as subprocesses with a temp config dir |

### Modified files

| File | Change |
|---|---|
| `scripts/session-file.js` | *(new)* |
| `scripts/pre-tool-use.js` | Import `updateSession` from `session-file.js`; after the existing `state.json` write, also call `updateSession` to increment `tool_counts[toolName]` |
| `scripts/post-tool-use.js` | Import `updateSession`; after state write, also call `updateSession` to increment `ext_counts[ext]` for file edits (toolName is `edit`, `create`, `view` for Copilot) |
| `scripts/user-prompt.js` | Import `updateSession`; record `last_prompt_at` and increment `turn_count` |
| `scripts/session-end.js` | Import `buildTelemetryFields`; merge result into JSONL record |
| `scripts/session-start.js` | Import `updateSession`, `logHookDebug`; use `updateSession` for the session file write (merges instead of overwrites); also capture `git_branch` via `git branch --show-current` and store in session file |
| `hooks.json` | Verify `userPromptSubmitted` → `session-promptsubmit.js` is listed (it currently routes to `user-prompt.js`; decide whether to merge or keep separate) |

### New JSONL fields

| Field | Source | Notes |
|---|---|---|
| `turn_count` | `userPromptSubmitted` count | One per user message |
| `tool_counts` | `preToolUse` accumulation | `{ "bash": 12, "edit": 4, ... }` |
| `ext_counts` | `postToolUse` file edits | `{ ".ts": 3, ".json": 1, ... }` |
| `response_time_p50_ms` | `userPromptSubmitted` timestamps | p50 of per-turn response times |
| `response_time_max_ms` | `userPromptSubmitted` timestamps | max response time in session |
| `response_time_count` | count of measured turns | |
| `git_branch` | `git branch --show-current` at session start | |
| `duration_secs` | `last_known_stats.total_duration_ms` if available; else `now - started_at` | |

### Tests

**`tests/telemetry.test.js`** — runs each hook script as a subprocess with `COPILOT_CONFIG_DIR` set to a temp directory:

- `session-file.js` unit tests: `updateSession` creates file when absent; merges fields atomically; handles concurrent writes via temp-rename
- `pre-tool-use.js` subprocess: verify `tool_counts.bash` increments correctly; verify `tool_counts` is absent for internal tools (`report_intent`, etc.)
- `post-tool-use.js` subprocess (file edit tools): verify `ext_counts['.ts']` increments for an edit to a `.ts` file
- `session-promptsubmit.js` subprocess: verify `turn_count` increments; verify `last_prompt_at` is written; verify `response_times` array gains an entry on second call
- `session-end.js` subprocess: verify `turn_count`, `tool_counts`, `ext_counts` appear in the JSONL record when present in session file
- `buildTelemetryFields` unit: omits empty maps; includes `subagent_count` when `subagents` array is populated; includes `response_time_p50_ms` when `response_times` has data

### Verification

```bash
# All tests pass
node tests/telemetry.test.js

# Manual: run a session with a few tool calls, end it, inspect the JSONL
cat ~/.copilot/copilot-hud/monthly/$(date +%Y-%m).jsonl | tail -1 | node -e \
  "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))" | \
  grep -E '"turn_count|tool_counts|ext_counts|git_branch"'
```

---

## ✅ Phase 3a — `burnrate-cost-summary` Skill

**Goal:** Port the cost summary skill from `burnrate-claude`. Shows session cost grouped by project and Jira ticket for a given month, with by-model breakdown and a `% of total` column.

**Entry criteria:** Phase 1 complete (Jira fields in JSONL)

**Design decisions:**
- Script reads from `~/.copilot/copilot-hud/monthly/YYYY-MM.jsonl` — identical schema to Claude version. Only change is `getClaudeConfigDir` → `getCopilotConfigDir`.
- Skill definition lives in `commands/burnrate-cost-summary.md` (Copilot CLI slash-command format).
- Reference output format doc is included so the skill can instruct the LLM how to present the output.

### New files

| File | Purpose |
|---|---|
| `commands/burnrate-cost-summary.md` | Skill definition — triggers, allowed tools, instruction to run script and present via OUTPUT_FORMAT.md |
| `skills/burnrate-cost-summary/scripts/summarize-costs.js` | Adapted from Claude version: `getCopilotConfigDir` for data dir; all other logic identical |
| `skills/burnrate-cost-summary/reference/OUTPUT_FORMAT.md` | Output format reference — copied from Claude version, update header to reference copilot-hud |

### Tests

**`tests/cost-summary.test.js`:**
- Script with empty JSONL exits cleanly with "No data file" message
- Script with sample JSONL produces correct total, by-model, by-project sections
- `--by-jira` flag shows Jira attribution section
- `--daily` flag shows per-day breakdown
- Date range filter (`from` / `to`) correctly limits included records
- `% of total` column sums to ~100% across all rows

### Verification

```bash
node tests/cost-summary.test.js

# Manual: write a synthetic JSONL to the monthly dir and invoke the skill
echo '{"id":"test-1","date":"2026-05-01","start_month":"2026-05","cost_usd":1.23,"model":"claude-sonnet-4.6","project":"my-app","jira_key":"PLAT-101","jira_costs":{"PLAT-101":1.23}}' \
  >> ~/.copilot/copilot-hud/monthly/2026-05.jsonl
node skills/burnrate-cost-summary/scripts/summarize-costs.js 2026-05 --by-project --by-jira
```

---

## ✅ Phase 3b — `burnrate-report` Skill

**Goal:** Package user data into a self-contained zip file for bug reports. Includes monthly cost records, session files, config, and `package.json`.

**Entry criteria:** Phase 2 complete (session files have telemetry fields worth including in a bug report)

**Design decisions:**
- Packages `~/.copilot/copilot-hud/` (monthly JSONL, session files, config, debug log if present) instead of `~/.claude/burnrate-claude/`.
- Uses Node's built-in `zlib` (deflate) — no npm deps.
- Default output path: `burnrate-report-YYYY-MM-DD.zip` in the current working directory.

### New files

| File | Purpose |
|---|---|
| `commands/burnrate-report.md` | Skill definition — triggers, instruction to run script and report output path |
| `skills/burnrate-report/scripts/report.js` | Adapted from Claude version: update data dir path to `~/.copilot/copilot-hud/`; update messages to reference `copilot-hud` |

### Tests

**`tests/report.test.js`:**
- Creates a zip in a temp dir; verifies the file exists and has non-zero size
- Verifies the zip contains at least one `monthly/*.jsonl` entry and the `config.json` entry when they exist
- Runs cleanly when the data directory is empty (no error, zip still created)
- `--output` flag writes to the specified path

### Verification

```bash
node tests/report.test.js

# Manual
node skills/burnrate-report/scripts/report.js --output /tmp/test-report.zip
ls -lh /tmp/test-report.zip
unzip -l /tmp/test-report.zip
```

---

## ✅ Phase 3c — `burnrate-optimize` Skill

**Goal:** Analyze session telemetry data and monthly JSONL records for cost and efficiency patterns. Produce a prioritized health report with actionable recommendations.

**Entry criteria:** Phase 2 complete (telemetry fields in JSONL)

**Design decisions:**
- **Copilot does not expose raw session transcripts** (`~/.claude/projects/**/*.jsonl`) the way Claude Code does. The Claude version's optimize skill analyzes those transcripts directly. The Copilot version must work from the monthly JSONL records and any telemetry fields captured there.
- Analysis checks: high-cost sessions (top 5 most expensive), model mix (are expensive models used for simple tasks?), session length distribution (very long sessions suggest unbounded loops), high tool-call sessions (`tool_counts` from Phase 2), and top file types edited (`ext_counts`).
- Produces a scored health report (HIGH/MEDIUM/LOW severity findings) with copy-paste recommendations.
- Because raw transcript analysis is not available, a "Data collection note" section tells the user what additional context would improve recommendations once more sessions accumulate telemetry fields.

### New files

| File | Purpose |
|---|---|
| `commands/burnrate-optimize.md` | Skill definition — triggers, instruction to run script and explain top finding |
| `skills/burnrate-optimize/scripts/optimize.js` | Copilot-specific implementation reading monthly JSONL + telemetry fields |

### Tests

**`tests/optimize.test.js`:**
- Exits cleanly with "No data" message when JSONL is absent
- Detects high-cost session finding when one session's cost > 3× the median
- Detects model mix finding when >50% of sessions use an expensive model
- Detects high tool-call finding when a session has `tool_counts` total > threshold
- Reports "insufficient data" cleanly when fewer than 5 sessions exist
- Output is formatted as plain text (no ANSI escape codes)

### Verification

```bash
node tests/optimize.test.js

# Manual: after Phase 2 has populated some JSONL records with telemetry
node skills/burnrate-optimize/scripts/optimize.js --days 30
```

---

## Phase 4 — Auto-configure statusLine

**Goal:** On session start, check whether `~/.copilot/config.json` already points to this plugin's statusline script. If not, configure it automatically and notify the user once. Idempotent — safe to run every session.

**Entry criteria:** Phase 2 complete

**Design decisions:**
- Targets `~/.copilot/config.json` (Copilot CLI's config file) with the format `{ "statusLine": { "type": "command", "command": "node /path/to/statusline.js" } }`.
- If `statusLine` is already set to a different command, the existing command is preserved as a `custom_command` widget in `~/.copilot/copilot-hud/config.json` and replaced with ours.
- Simpler than the Claude version — no launcher file indirection, no `settings.json` vs `config.json` distinction.
- `PLUGIN_ROOT` environment variable (set by Copilot CLI) provides the absolute plugin path.

### New files

| File | Purpose |
|---|---|
| `scripts/statusline-config.js` | `ensureStatusLineConfig(pluginRoot, copilotConfigDir, dataDir)` — idempotent auto-configure; returns notification string on change or null when already configured |

### Modified files

| File | Change |
|---|---|
| `scripts/session-start.js` | Call `ensureStatusLineConfig(process.env.PLUGIN_ROOT, copilotConfigDir, dataDir)` early in the hook; if a notification string is returned, emit it as `additionalContext` |

### Tests

**`tests/statusline-config.test.js`:**
- No existing config → writes `statusLine` entry, returns notification string
- Already pointing to our script → returns null (no-op)
- Different command present → migrates existing command as `custom_command` widget, replaces `statusLine`, returns notification string describing the migration
- Malformed `config.json` → returns null (does not throw or corrupt the file)
- Missing `config.json` → creates it with `statusLine` entry

### Verification

```bash
node tests/statusline-config.test.js

# Manual: temporarily rename ~/.copilot/config.json, run a session,
# verify config.json is created with the correct statusLine entry
```

---

## Phase 5 — Debug Tooling

**Goal:** Add a debug mode that captures full hook payloads to a JSONL log. Provide a viewer script so it's easy to inspect what Copilot CLI sends for each hook type — essential for validating that field names and shapes match what the hook scripts expect.

**Entry criteria:** Phase 2 complete (session-file.js already has `logHookDebug`)

**Design decisions:**
- Activated by `COPILOT_HUD_DEBUG=1` environment variable.
- Debug log written to `~/.copilot/copilot-hud/debug/hooks.jsonl`.
- `show-hook-debug.js` reads the log and pretty-prints entries, grouped by hook type, newest first.
- `logHookDebug` is already defined in `session-file.js` from Phase 2; this phase just wires it into the remaining hook scripts and adds the viewer.

### New files

| File | Purpose |
|---|---|
| `scripts/show-hook-debug.js` | CLI viewer for `debug/hooks.jsonl` — adapted from Claude version; update paths and field names for Copilot |

### Modified files

| File | Change |
|---|---|
| `scripts/pre-tool-use.js` | Add `logHookDebug('preToolUse', data, sessionId)` call |
| `scripts/post-tool-use.js` | Add `logHookDebug('postToolUse', data, sessionId)` call |
| `scripts/user-prompt.js` | Add `logHookDebug('userPromptSubmitted', data, sessionId)` call |
| `scripts/session-start.js` | Add `logHookDebug('sessionStart', data, sessionId)` call |
| `scripts/session-end.js` | Add `logHookDebug('sessionEnd', data, sessionId)` call |

### Validation

```bash
# Run a short session with debug enabled
COPILOT_HUD_DEBUG=1 node scripts/session-start.js <<< '{"session_id":"dbg-test","model":{"id":"claude-sonnet-4.6"},"cwd":"/tmp"}'
node scripts/show-hook-debug.js

# Verify hooks.jsonl exists and contains an entry with hook: "sessionStart"
cat ~/.copilot/copilot-hud/debug/hooks.jsonl | \
  node -e "process.stdin.on('data',d=>console.log(JSON.parse(d.toString().split('\n')[0]).hook))"
```

---

## Phase 7 — Pricing Maintenance Tooling

**Goal:** Provide maintainer scripts to keep `pricing.json` accurate as GitHub changes model rates and adds new models. Also provide a model ID verification utility so that pricing.json keys can be confirmed against real Copilot session data without submitting full requests to each model.

**Entry criteria:** None — can be done any time. Evaluate before each release when GitHub announces pricing changes.

**Design decisions:**

- **No network calls in production paths.** `statusline.js`, `session-start.js`, and all hook scripts must never make outbound HTTP requests. Pricing data is always read from the bundled `pricing.json` — the staleness warning in `pricing.js` (60-day threshold, stderr only) is sufficient runtime alerting.
- **`scripts/update-pricing.js`** is a *maintainer tool* run locally before cutting a release. It fetches the GitHub docs pricing page, parses the HTML tables, and prints a diff against the current `pricing.json`. It does **not** write the file automatically — the maintainer reviews the diff and applies it. This avoids silent overwrites.
- **`scripts/verify-model-ids.sh`** verifies pricing.json keys against the actual `model.id` values Copilot CLI sends. Strategy: start a `copilot` session with each `--model <id>` flag, immediately quit (no message needed), and read `model_id` from the session file written by the `sessionStart` hook. Compare against the pricing.json key. Any mismatch is flagged.
- Pricing source URL is already in `pricing.json` `_meta.source` and `pricing.js` header comment.

### New files

| File | Purpose |
|---|---|
| `scripts/update-pricing.js` | Maintainer tool: fetch GitHub docs pricing page, parse HTML tables, print diff vs current `pricing.json`. Requires Node.js built-in `https`/`http` — no npm deps. Dry-run only; does not write files. |
| `scripts/verify-model-ids.sh` | Maintainer tool: for each model key in `pricing.json`, start `copilot --model <key>`, exit immediately, read `model_id` from the session file, compare. Reports MATCH / MISMATCH / NOT_FOUND. Requires `jq`. |

### Verification

```bash
# Run the pricing updater — review the diff output
node scripts/update-pricing.js

# Run the model ID verifier — all lines should show MATCH
bash scripts/verify-model-ids.sh

# Confirm no network calls are made during normal statusline operation
node scripts/statusline.js <<< '{"session_id":"test","model":{"id":"claude-sonnet-4.6"},"cwd":"/tmp","context_window":{},"cost":{}}'
# Should complete instantly (< 50ms) with no DNS lookups
```

---

## Phase 6 — Docs Completion

Update `docs/data-points.md` and `docs/quick-start.md` to reflect all phases above once they are complete.

**`docs/data-points.md`** — add entries for every new field added in Phases 1 and 2 (jira fields, telemetry fields). Follow the same table format as `burnrate-claude`: source, hook, what it captures, insights, optimize relevance.

**`docs/quick-start.md`** — document all three skills, the config.json `jira` block, debug mode, and the auto-configure behaviour.

---

## Test Runner

All tests use Node.js's built-in `node:test` — no additional packages required. Run the full suite:

```bash
node tests/jira-detector.test.js
node tests/jira-attribution.test.js
node tests/jira-widget.test.js
node tests/telemetry.test.js
node tests/cost-summary.test.js
node tests/report.test.js
node tests/optimize.test.js
node tests/statusline-config.test.js
```

Or all at once:

```bash
for f in tests/*.test.js; do echo "▶ $f" && node "$f"; done
```
