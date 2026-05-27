# burnrate-copilot — Accurate Cost & Data Capture Plan

This plan implements accurate multi-model cost tracking, subagent cost attribution, and enriched session telemetry by leveraging the newly-discovered `events.jsonl` data source and additional hook registrations.

**Key finding:** Copilot CLI's statusline `total_*_tokens` fields **include subagent tokens** — unlike Claude Code where subagent costs are hidden. However, our current implementation applies a single model's pricing to ALL tokens, which is incorrect for multi-model sessions (measured 3.2% error on real data). The fix requires per-model token attribution from `session.shutdown.modelMetrics`.

**Reference:** See `copilot-data.md` at repo root for complete schema documentation.

---

## Baseline: What's Already Working

- Plugin skeleton, session lifecycle (start/end), hooks.json
- Full widget compositor (powerline + plain), config system
- All widgets: model_name, session_duration, context_window, git, tools, etc.
- Tool and agent activity tracking (pre/post-tool-use hooks, state.js)
- Cost calculation from statusline tokens (single-model pricing)
- Monthly JSONL with session telemetry, tool_counts, turn_counts
- Jira cost attribution from git branch
- Orphan session recovery

---

## Task 1 — Verify Subagent Token Inclusion in StatusLine ✅

**Status:** COMPLETE

**Goal:** Confirm empirically that Copilot CLI's statusline `context_window.total_*_tokens` includes subagent tokens, and quantify the cost error from single-model pricing.

**Why first:** In Claude Code, subagent tokens were NOT included in the statusline — they were a hidden cost. We need to confirm this is NOT the case here before building solutions on top of the statusline data.

**Work:**
1. Write a verification script (`scripts/verify-subagent-tokens.js`) that:
   - Scans `~/.copilot/session-state/` for sessions with `subagent.completed` events
   - For each such session, extracts `session.shutdown.modelMetrics` token totals
   - Compares against the monthly JSONL `final_tokens` (which came from the statusline)
   - Reports: match/mismatch, per-model breakdown, cost error from single-model pricing
2. Run it against existing session data
3. Document findings in the script's header comments

**Verification:**
- Script runs without error: `node scripts/verify-subagent-tokens.js`
- Output shows at least 2 sessions with subagents
- Output confirms tokens match (statusline includes subagent tokens)
- Output shows the cost error percentage from single-model pricing
- Script confirms: "Subagent tokens ARE included in statusline totals"

**Acceptance criteria:**
- Script produces a clear PASS/FAIL verdict
- If PASS: subagent tokens are included, single-model pricing is the only cost error
- If FAIL: we need to add subagent token tracking before proceeding

---

## Task 2 — Parse events.jsonl for session.shutdown modelMetrics ✅

**Status:** COMPLETE

**Goal:** At SessionEnd, read the session's `events.jsonl` to extract `session.shutdown.modelMetrics` and compute accurate per-model cost.

**Why:** The statusline gives us aggregate tokens but no per-model split. `session.shutdown` fires just before SessionEnd and contains the authoritative per-model breakdown. This eliminates the 3.2% cost error from single-model pricing.

**Work:**
1. Create `scripts/events-parser.js` with:
   - `parseShutdownMetrics(sessionId)` — reads `events.jsonl`, finds `session.shutdown`, returns `modelMetrics`
   - `computeMultiModelCost(modelMetrics, pricingDir)` — computes cost per model using each model's pricing
2. Update `scripts/session-end.js` to:
   - Call `parseShutdownMetrics()` before writing the monthly record
   - If modelMetrics available: compute per-model cost, sum for total
   - If unavailable (old session or crash): fall back to current single-model computation
   - Add `model_metrics` field to the monthly JSONL record
3. Update monthly JSONL schema to include per-model breakdown

**Verification:**
- Unit test: `node tests/events-parser.test.js` passes (uses fixture events.jsonl)
- Integration: Start a session, use at least 2 models (e.g. switch model mid-session), end session
- Monthly JSONL record for that session contains `model_metrics` with correct per-model costs
- Fallback: delete events.jsonl before session end → still produces a valid record with single-model cost

**Acceptance criteria:**
- `cost_usd` in monthly JSONL matches per-model computation (not single-model approximation)
- Existing sessions without events.jsonl still work (graceful fallback)

---

## Task 3 — Real-Time Multi-Model Cost in StatusLine ✅

**Status:** COMPLETE

**Goal:** Track per-model token attribution during the session (not just at shutdown) so the statusline shows accurate cost in real-time.

**Why:** Task 2 fixes cost at session end, but the live statusline still uses single-model pricing. Model switches happen mid-session via `session.model_change` events.

**Work:**
1. Update `scripts/session-start.js` to initialize `model_tokens` map in the session file
2. Update `scripts/compositor.js` (`loadSessionData`) to:
   - Track the current model from statusline `model.id`
   - On each turn, compute token delta from previous `last_known_tokens`
   - Attribute the delta to the current model's bucket
   - Compute total cost as sum of per-model costs
3. Session file gains: `model_tokens: { "claude-opus-4.6": { input: N, output: N, cache_write: N, cache_read: N } }`
4. Statusline cost widget uses the per-model sum instead of single-model computation

**Verification:**
- Start session with model A → do some work → switch to model B → do more work
- StatusLine cost should be lower than naive single-model (if model B is cheaper)
- At session end, compare statusline cost vs `session.shutdown.modelMetrics` cost
- Error should be < 0.5% (small timing gaps between model switch and next statusline call)

**Acceptance criteria:**
- Multi-model sessions show accurate real-time cost (within 1% of shutdown-verified total)
- Single-model sessions (the common case) work identically to before

---

## Task 4 — Subagent Cost Attribution in Monthly Records ✅

**Status:** COMPLETE

**Goal:** Record per-subagent cost breakdowns in the monthly JSONL so the optimize skill can analyze which agents cost most.

**Why:** `subagent.completed` events provide `totalTokens`, `model`, and `durationMs` — everything needed to compute per-agent cost. This enables "which agent types are expensive?" analysis.

**Work:**
1. Extend `scripts/events-parser.js` with:
   - `parseSubagentCompletions(sessionId)` — extracts all `subagent.completed` events
   - Returns: `[{ name, model, totalTokens, durationMs, totalToolCalls, costUsd }]`
2. Update `scripts/session-end.js` to:
   - Call `parseSubagentCompletions()` 
   - Add `subagents_detail` array to monthly JSONL record
3. Monthly JSONL gains:
   ```json
   "subagents_detail": [
     { "name": "rubber-duck", "model": "gpt-5.5", "tokens": 375820, "cost_usd": 0.42, "duration_ms": 416707, "tool_calls": 17 }
   ]
   ```

**Verification:**
- Run a session that spawns at least one subagent (e.g. use `task` tool)
- Monthly JSONL record contains `subagents_detail` with correct cost per agent
- `sum(subagents_detail[].cost_usd)` ≤ `cost_usd` (subagent cost is subset of total)
- Verify: subagent model pricing is used (not parent model pricing)

**Acceptance criteria:**
- Monthly record shows per-subagent breakdown with accurate cost
- Sessions without subagents omit the field (no empty arrays)

---

## Task 5 — Register SubagentStart/SubagentStop Hooks ✅

**Status:** COMPLETE

**Goal:** Track subagent lifecycle in real-time via hooks (independent of events.jsonl parsing).

**Why:** Hooks fire synchronously during the session, enabling real-time agent status in the statusline. Currently we only detect agents via the `task` preToolUse workaround, which misses agent name, model, and completion timing.

**Work:**
1. Add to `hooks.json`:
   ```json
   "subagentStart": [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/subagent-start.js", "timeoutSec": 5 }],
   "subagentStop":  [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/subagent-stop.js",  "timeoutSec": 5 }]
   ```
2. Create `scripts/subagent-start.js`:
   - Parse stdin: `{ sessionId, transcriptPath, agentName, agentDisplayName, agentDescription }`
   - Update `hud-state.json` agents array with richer metadata
   - Update session file `subagents[]` with name and model (from agentName mapping or description)
3. Create `scripts/subagent-stop.js`:
   - Parse stdin: `{ sessionId, transcriptPath, agentName, agentDisplayName, stopReason }`
   - Mark agent as completed in `hud-state.json`
   - Record end time in session file
4. Remove the `task` tool workaround from `pre-tool-use.js` (no longer needed)

**Verification:**
- Run session, spawn a subagent → statusline shows agent name (not just "running")
- Agent completion updates status correctly
- `hud-state.json` shows `agentName` and `agentDisplayName`
- Session file `subagents[]` has accurate start/end times

**Acceptance criteria:**
- Subagent lifecycle tracked without relying on `task` tool detection
- Statusline shows agent display name while running
- No regression: sessions without subagents still work

---

## Task 6 — Register PreCompact Hook & Bank Pre-Compaction Cost ✅

**Status:** COMPLETE

**Goal:** Prevent cost undercount when context compaction occurs.

**Why:** Compaction resets the context window. If we only track token deltas from the statusline, post-compaction tokens are lower than pre-compaction, causing our delta calculation to produce negative values (clamped to 0 = lost cost). We need to bank the cost before compaction.

**Work:**
1. Add to `hooks.json`:
   ```json
   "preCompact": [{ "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/pre-compact.js", "timeoutSec": 5 }]
   ```
2. Create `scripts/pre-compact.js`:
   - Read session file's `last_known_cost`
   - Write `compaction_banked_cost` to the session file
   - Reset `snapshot` to current `last_known_tokens` (new baseline post-compaction)
3. Update `scripts/compositor.js`:
   - Session cost = `compaction_banked_cost` + computed cost since last snapshot
4. Update `scripts/session-end.js`:
   - Include compaction data in monthly record

**Verification:**
- Simulate compaction: Start session, accumulate significant tokens, trigger `/compact`
- After compaction: statusline cost should NOT drop
- Monthly record `cost_usd` should include pre-compaction cost
- Verify with `events.jsonl`: `session.compaction_complete.preCompactionTokens` should match banked amount

**Acceptance criteria:**
- Cost never decreases during a session (monotonically increasing)
- Sessions with 0 compactions work identically to before (no regression)
- Monthly record reflects true total cost including pre-compaction tokens

---

## Task 7 — Compaction Token Cost Tracking ✅

**Status:** COMPLETE

**Goal:** Track the token cost of compaction itself (it makes a separate API call).

**Key Finding:** Compaction tokens are ALREADY INCLUDED in modelMetrics totals.
They are NOT separately billed. The `compaction_cost` field is purely informational —
it shows what portion of the total session cost went to compaction API calls (~1-3% avg).

**Work completed:**
1. ✅ `parseCompactionCosts(sessionId, pricingTable)` in events-parser.js — extracts per-compaction breakdown
2. ✅ `session-end.js` includes `compaction_cost` metadata in monthly JSONL
3. ✅ Verified across 19 real sessions: compaction cost is always a proper subset of total
4. ✅ Created `scripts/verify-compaction-cost.js` — formal verification script
5. ✅ Added 5 new tests (3 unit + 2 integration) — all pass

**Important:** `compaction_cost` is NOT added to `cost_usd` (would be double-counting).
Monthly JSONL schema:
```json
"compaction_cost": { "count": 4, "total_cost_usd": 1.96, "compactions": [{ "model": "claude-sonnet-4.6", "input_tokens": 131504, "output_tokens": 2706, "cost_usd": 0.47, "duration_ms": 8500 }] }
```

**Verification result:** 19/19 sessions PASS — compaction always < total. Average: 1.0% of total cost.

---

## Task 8 — Enriched Monthly Records

**Goal:** Add all available signals from `session.shutdown` to the monthly JSONL for the optimize skill.

**Why:** The shutdown event contains data we don't currently capture: `filesModified`, `premiumRequests`, `reasoningTokens`, context breakdown, and precise timing.

**Work:**
1. Extend `scripts/events-parser.js`:
   - `parseShutdownEnriched(sessionId)` — extracts all useful fields from shutdown
2. Update `scripts/session-end.js` to include:
   - `files_modified: string[]` — list of modified file paths
   - `files_modified_count: number`
   - `premium_requests: number` — from `totalPremiumRequests`
   - `api_duration_ms: number` — from `totalApiDurationMs`  
   - `reasoning_tokens: number` — sum across models
   - `context_breakdown: { system, conversation, tool_definitions }` — token allocation
   - `models_used: string[]` — all model IDs used
3. Ensure backward compatibility: new fields are optional, old records still parse

**Verification:**
- End a session → monthly record contains all new fields
- `node -e "require('./scripts/events-parser').parseShutdownEnriched('session-id')"` returns expected data
- `burnrate-cost-summary` skill still works with both old and new record formats
- `files_modified_count` matches git diff expectations

**Acceptance criteria:**
- Monthly JSONL contains enriched fields for new sessions
- Old records without these fields don't break any consumers
- Optimize skill can query: "which sessions had reasoning tokens?" or "which sessions modified most files?"

---

## Task 9 — Events.jsonl Watcher for Live Subagent Display ✅

**Status:** COMPLETE

**Goal:** Read subagent events from events.jsonl in near-real-time for the statusline, as a supplement to the hooks (which may not yet be available in all Copilot versions).

**Why:** Not all Copilot CLI versions may dispatch `subagentStart`/`subagentStop` hooks, but ALL versions write to events.jsonl. A watcher provides a fallback.

**Work:**
1. Create `scripts/events-watcher.js`:
   - Tails the current session's `events.jsonl` (maintains file position in session state)
   - On each statusline call: read new lines since last position
   - Extract `subagent.started`/`subagent.completed` events
   - Update hud-state.json with agent status
2. Update `scripts/compositor.js`:
   - Call watcher on each render if hooks didn't fire (detection: agent in events but not in hud-state)
3. Watcher is a supplement, not a replacement — hooks are preferred when available

**Verification:**
- Disable subagent hooks → spawn subagent → statusline still shows agent activity
- Re-enable hooks → both sources agree (no duplicate agents displayed)
- Performance: watcher adds < 50ms to statusline render

**Acceptance criteria:**
- Subagent display works with OR without subagent hooks registered
- No performance regression for sessions without subagents

---

## Task 10 — Optimize Skill Integration

**Goal:** Ensure the `burnrate-optimize` skill can query the enriched monthly data to surface actionable cost insights.

**Why:** All the data capture is only valuable if the optimize skill can query it to find patterns: expensive subagent types, cache inefficiency, model selection waste, etc.

**Work:**
1. Update `skills/burnrate-optimize/` to query new fields:
   - "Which subagent types cost most?" — query `subagents_detail`
   - "What's my cache hit rate?" — compute from `final_tokens`
   - "Which sessions used reasoning tokens?" — query `reasoning_tokens`
   - "What's my model cost distribution?" — query `model_metrics`
   - "Which sessions had compaction overhead?" — query `compaction_costs`
2. Add optimization recommendations:
   - If cache_read/total_input ratio < 60%: "Context may be too volatile — consider longer sessions"
   - If reasoning_tokens > 10% of total: "Extended thinking is adding significant cost"
   - If subagent cost > 30% of session: "Subagent usage is a major cost driver"
3. Write example queries and test with real data

**Verification:**
- Run `/burnrate-optimize` in a session → produces at least 3 actionable insights
- Insights reference specific sessions and dollar amounts
- Recommendations are accurate (verified manually against JSONL data)

**Acceptance criteria:**
- Optimize skill surfaces insights from ALL new data fields
- No false recommendations (e.g. don't recommend reducing subagents if they saved time)
- Works with both old (sparse) and new (enriched) monthly records

---

## Task 11 — Retroactive Cost Recomputation

**Goal:** Recompute cost for historical sessions that have `final_tokens` but `cost_pending: true` or inaccurate single-model costs.

**Why:** Early sessions were recorded before pricing was implemented. Sessions with events.jsonl can be recomputed with per-model accuracy.

**Work:**
1. Create `scripts/recompute-costs.js`:
   - Reads monthly JSONL files
   - For each record with `cost_pending: true` OR `final_tokens` present:
     - If events.jsonl exists: recompute from `modelMetrics`
     - Else: recompute from `final_tokens` using best-guess model pricing
   - Writes corrected records back (atomic replace)
2. Add a `/burnrate:recompute` command that runs this script
3. Report: number of records updated, total cost delta

**Verification:**
- Run against existing 2026-05.jsonl
- Records with `cost_pending: true` get corrected costs
- Records with `cost_pending: false` but multi-model get more accurate costs
- Total MTD changes by the expected amount
- Original file is backed up before modification

**Acceptance criteria:**
- All `cost_pending` records resolved
- Multi-model records get per-model accurate cost
- Backup file preserved at `monthly/YYYY-MM.jsonl.bak`
- Running twice is idempotent (no double-correction)

---

## Dependency Graph

```
Task 1 (verify) → Task 2 (shutdown parsing) → Task 3 (real-time multi-model)
                                             → Task 4 (subagent detail)
                                             → Task 7 (compaction cost)
                                             → Task 8 (enriched records)
                                             → Task 11 (retroactive recompute)

Task 5 (subagent hooks) → Task 9 (events watcher fallback)

Task 6 (preCompact hook) — independent

Tasks 2-8 → Task 10 (optimize integration)
```

---

## Monthly JSONL Target Schema (after all tasks)

```json
{
  "id": "session-uuid",
  "date": "YYYY-MM-DD",
  "start_month": "YYYY-MM",
  "cost_usd": 99.71,
  "cost_pending": false,
  "model": "claude-opus-4.6",
  "models_used": ["claude-opus-4.6", "gpt-5.5", "claude-haiku-4.5"],
  "model_metrics": {
    "claude-opus-4.6": { "input": 12116761, "output": 76438, "cache_read": 10621575, "cache_write": 1476728, "reasoning": 0, "cost_usd": 77.04, "requests": 129 },
    "gpt-5.5": { "input": 3163582, "output": 29684, "cache_read": 2984960, "cache_write": 0, "reasoning": 0, "cost_usd": 18.20, "requests": 43 }
  },
  "final_tokens": { "total_input_tokens": 16091871, "total_output_tokens": 110901, "total_cache_write_tokens": 2043919, "total_cache_read_tokens": 13850828 },
  "project": "website",
  "project_id": "-Users-bripley-Projects-personal-website",
  "premium_requests": 146.16,
  "api_duration_ms": 2126547,
  "reasoning_tokens": 13076,
  "context_breakdown": { "system": 9826, "conversation": 82976, "tool_definitions": 16543 },
  "files_modified": ["src/app.js", "src/utils.js"],
  "files_modified_count": 2,
  "subagents_detail": [
    { "name": "rubber-duck", "model": "gpt-5.5", "tokens": 375820, "cost_usd": 5.27, "duration_ms": 416707, "tool_calls": 17 }
  ],
  "compaction_costs": [
    { "input": 137858, "output": 3275, "cache_read": 135252, "model": "claude-sonnet-4.6", "cost_usd": 0.045 }
  ],
  "turn_count": 29,
  "tool_counts": { "bash": 60, "view": 18, "create": 83 },
  "ext_counts": { ".md": 45, ".js": 10 },
  "subagent_count": 3,
  "subagent_types": { "explore": 2, "general-purpose": 1 },
  "turn_interval_p50_ms": 877704,
  "turn_interval_max_ms": 74539980,
  "git_branch": "main",
  "jira_costs": { "PROJ-123": 50.0, "unattributed": 49.71 },
  "jira_key": "PROJ-123",
  "recovered": false
}
```
