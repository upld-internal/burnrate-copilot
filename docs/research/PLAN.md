# Plan: Copilot Internal API — Primary Quota Source

## Context

The plugin currently derives MTD cost from `ai_used.total_nano_aiu` in the statusline stdin and
from accumulated session JSONL files. It has no authoritative view of the user's quota allocation,
credits remaining, or overage status.

The undocumented `GET https://api.github.com/copilot_internal/user` endpoint (confirmed live,
documented in `docs/research/copilot-api.md`) provides exactly this — `entitlement`, `remaining`,
`quota_remaining`, `percent_remaining`, `overage_count`, `overage_permitted`, and
`quota_reset_date_utc` for `premium_interactions`. This is the same data shown on the GitHub
billing dashboard. The goal is to use it as the primary quota source while keeping the existing
JSONL-based cost tracking as the cost source.

Because the endpoint is undocumented, we must:
1. Treat every call as potentially broken (schema drift, auth failure, timeout)
2. Persist the last-known values so the UI degrades gracefully
3. Stop trying after repeated failures so a broken API doesn't add latency on every turn

---

## Data Model Clarification

**AI Credits confirmed:** `entitlement: 3000` = 3000 AI credits/month. 1 AI credit = $0.01 USD.
Cross-verified on 2026-06-02: API returned `used = 2747.40 credits = $27.47`, matching GitHub
billing UI exactly (2747.39 credits / $27.47). Conversion: `credits_used = entitlement - quota_remaining`.

Three independent data streams feed the statusline:

| Data | Source | Update cadence | How read |
|---|---|---|---|
| `total_nano_aiu` (session cost) | Copilot stdin payload | Every turn — already live | Synchronous read from `stdinData.ai_used` |
| MTD credits + MTD cost | `copilot_internal/user` API | Per AI credit consumed | Background cache, synchronous read from file |
| JSONL records | `monthly/YYYY-MM.jsonl` | On session end | Still written; used for per-project/Jira breakdown only |

**MTD display source change:** `mtd_cost` and `mtd_credits` now read from the API cache as
primary source. This fixes the mid-month install problem — the API reflects the full billing
period regardless of when the plugin was installed. Conversion:
```
mtd_credits_used = entitlement - quota_remaining   // e.g. 3000 - 252.6 = 2747.4
mtd_cost_usd     = mtd_credits_used / 100          // e.g. 2747.4 / 100 = $27.47
```
Fallback (API unavailable): existing JSONL sum + current session nano_aiu (unchanged behaviour).

---

## Key Constraint: render() Must Stay Synchronous

`compositor.js` → `render()` → `loadSessionData()` is a fully synchronous call chain.
`statusline.js` must write one line to stdout and exit; the Copilot CLI pipe protocol has no
concept of async completion. All quota data must be read synchronously from a cache file.
Fetching happens in a **detached background child process**, never in the render path.

---

## Architecture

```
session-start.js          statusline.js (every turn)
      │                          │
      │  spawn (detach+unref)    │  after stdout written
      ▼                          ▼
quota-fetch.js ──────────► maybeSpawnRefresh()
  (async)                        │ spawn only if stale + circuit closed + no pending
      │                          │
      ▼                          ▼
quota-cache.json          quota-state.json (circuit breaker)
      │
      ▼ (synchronous read)
compositor.js loadSessionData()  ←── also falls back to session.last_known_quota
      │
      ▼
sessionData.quota* properties
      │
      ▼
cost.js widgets: quota_remaining / quota_used / overage_status
```

**Cache TTL:** 5 minutes (configurable via `CACHE_TTL_MS` constant in `quota-api.js`)

**Cache file:** `~/.copilot/plugin-data/burnrate-copilot/quota-cache.json`
```json
{
  "fetched_at": "2026-06-02T13:41:20Z",
  "entitlement": 3000,
  "remaining": 252,
  "quota_remaining": 252.6,
  "percent_remaining": 8.4,
  "overage_permitted": true,
  "overage_count": 0,
  "quota_reset_date_utc": "2026-07-01T00:00:00.000Z"
}
```

**State file:** `~/.copilot/plugin-data/burnrate-copilot/quota-state.json`
```json
{
  "consecutive_failures": 0,
  "last_attempt_at": null,
  "last_success_at": "2026-06-02T13:00:00Z",
  "circuit_open_until": null,
  "refresh_pending_since": null
}
```

---

## Circuit Breaker Design

- **Failure threshold:** 3 consecutive failures → open circuit
- **Cooldown:** `circuit_open_until = now + 1 hour` when circuit opens
- **Auto-close:** circuit auto-closes when `circuit_open_until` is in the past
- **Pending guard:** `refresh_pending_since` prevents duplicate spawns; treated as stale after 30s
  (handles crash of background process without cleanup)
- **Reset:** any success resets `consecutive_failures = 0` and clears `circuit_open_until`

```
shouldRefresh(cache, state) returns true when ALL of:
  - cache is missing OR cache.fetched_at is > CACHE_TTL ago (5 min)
  - circuit is not open (circuit_open_until is null or in the past)
  - no pending refresh (refresh_pending_since is null or > 30s ago)
```

---

## Fallback Chain (in compositor.js)

1. `quota-cache.json` exists and `fetched_at` < 5 min ago → use it, `sd.quotaStale = false`
2. `quota-cache.json` exists but stale → use it, `sd.quotaStale = true`, tilde prefix in UI
3. No cache → try `session.last_known_quota` → use it, `sd.quotaStale = true`
4. Nothing → `sd.hasQuota = false` → quota widgets return `null` (hidden)

---

## Files

### New: `scripts/quota-api.js`
Pure synchronous utilities. No network, no child_process.

Exports:
- `readQuotaCache(dataDir)` → `{ data, stale, ageMs }` | `{ data: null }`
- `readQuotaState(dataDir)` → state object (or defaults if missing/malformed)
- `writeQuotaState(dataDir, state)` → void (atomic write via tmp+rename)
- `isCircuitOpen(state)` → boolean
- `shouldRefresh(cacheResult, state)` → boolean
- `parseApiResponse(json)` → normalized quota data | null (validates schema)
- `findPremiumSnapshot(quotaSnapshots)` → snapshot | null (name match, then first has_quota:true)

Constants: `CACHE_TTL_MS` (5 min), `CIRCUIT_OPEN_DURATION_MS` (1 hr), `FAILURE_THRESHOLD` (3),
`REFRESH_PENDING_TIMEOUT_MS` (30 s)

### New: `scripts/quota-fetch.js`
Async standalone script. Run as detached background process.

Flow:
1. Read `quota-state.json`; if circuit open, exit 0 (nothing to do)
2. Mark `refresh_pending_since = now` in state
3. Get token: `GH_TOKEN` env → `COPILOT_QUOTA_MOCK_RESPONSE` env (test hook) → `execFileSync('gh', ['auth', 'token'])`
4. If mock response env set: skip network entirely
5. `fetch(url, { signal: AbortController(3000ms) })`
6. Parse + validate with `parseApiResponse()`
7. **Success:** write `quota-cache.json`, reset circuit state
8. **Failure:** increment `consecutive_failures`, open circuit if ≥ threshold
9. Clear `refresh_pending_since`, write `quota-state.json`, exit

Environment hooks for testing:
- `GH_TOKEN` — use directly instead of calling `gh auth token`
- `COPILOT_QUOTA_MOCK_RESPONSE` — JSON string; skip network, parse this instead

### Modify: `scripts/compositor.js`

In `loadSessionData()`, after reading session file (~line 145):
```javascript
// Read quota from cache (synchronous, ~0ms)
try {
  const { readQuotaCache } = require('./quota-api');
  const { data: qd, stale } = readQuotaCache(dataDir);
  const quota = qd || session?.last_known_quota || null;
  if (quota) {
    sd.quotaRemaining    = quota.quota_remaining;
    sd.quotaEntitlement  = quota.entitlement;
    sd.quotaPercent      = quota.percent_remaining;
    sd.quotaResetDate    = quota.quota_reset_date_utc;
    sd.quotaOverage      = quota.overage_count ?? 0;
    sd.quotaOverageOk    = quota.overage_permitted ?? false;
    sd.quotaStale        = stale || !qd; // stale if from session fallback
    sd.hasQuota          = true;
  }
} catch (_) {}
```

In the session write-back block (~line 213), also write `last_known_quota`:
```javascript
if (sd.hasQuota) {
  sessionRaw.last_known_quota = {
    entitlement:           sd.quotaEntitlement,
    remaining:             Math.floor(sd.quotaRemaining),
    quota_remaining:       sd.quotaRemaining,
    percent_remaining:     sd.quotaPercent,
    overage_permitted:     sd.quotaOverageOk,
    overage_count:         sd.quotaOverage,
    quota_reset_date_utc:  sd.quotaResetDate,
    captured_at:           now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}
```

### Modify: `scripts/statusline.js`

After `process.stdout.write(output + '\n')` (~line 51):
```javascript
// Spawn background quota refresh if cache is stale and circuit is closed
try {
  const { readQuotaCache, readQuotaState, shouldRefresh, writeQuotaState } = require('./quota-api');
  const cacheResult = readQuotaCache(dataDir);
  const state = readQuotaState(dataDir);
  if (shouldRefresh(cacheResult, state)) {
    writeQuotaState(dataDir, { ...state, refresh_pending_since: new Date().toISOString() });
    const { spawn } = require('child_process');
    const child = spawn(process.execPath,
      [path.join(__dirname, 'quota-fetch.js')],
      { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  }
} catch (_) {}
```

### Modify: `scripts/session-start.js`

After the session file is written (~line 214), kick off initial fetch:
```javascript
// Trigger quota fetch in background so first statusline turn has fresh data
try {
  const { readQuotaCache, readQuotaState, shouldRefresh, writeQuotaState } = require('./quota-api');
  const cacheResult = readQuotaCache(dataDir);
  const state = readQuotaState(dataDir);
  if (shouldRefresh(cacheResult, state)) {
    writeQuotaState(dataDir, { ...state, refresh_pending_since: new Date().toISOString() });
    const { spawn } = require('child_process');
    const child = spawn(process.execPath,
      [path.join(__dirname, 'quota-fetch.js')],
      { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  }
} catch (_) {}
```

### Modify: `scripts/widgets/cost.js`

Add three new widget functions:

**`quota_remaining`** — primary quota display
- `sd.hasQuota` falsy → `null`
- Stale: `~252 left` / Fresh: `252 left`
- Includes reset date: `252 left · resets Jul 1`
- opts: `show_reset_date` (default true), `show_label` (default false)

**`quota_used`** — used-vs-entitlement
- `sd.hasQuota` falsy → `null`
- Format: `2748/3000 (91.6%)` (powerline: `2748/3000`)

**`overage_status`** — only visible when `sd.quotaOverage > 0`
- Returns `null` when overage_count is 0
- Format: `+3 overage` (powerline: `+3 over`)

---

## Tests

### `tests/quota-api.test.js` — unit tests, no network
Uses real temp dirs (matches existing pattern).

Cases:
- `readQuotaCache`: fresh file → `{ data, stale: false }` / stale → `{ data, stale: true }` / missing → `{ data: null }` / malformed → `{ data: null }`
- `parseApiResponse`: valid full response / missing `premium_interactions` / all-unlimited / null / wrong types
- `findPremiumSnapshot`: by name / fallback to first `has_quota: true` / none found
- `isCircuitOpen`: `circuit_open_until` in future (open) / in past (closed) / null (closed)
- `shouldRefresh`: matrix of (fresh/stale/missing cache) × (open/closed circuit) × (pending/not/stale-pending)
- `writeQuotaState` / `readQuotaState`: roundtrip / missing file returns defaults / malformed returns defaults

### `tests/quota-fetch.test.js` — subprocess integration tests
Runs `quota-fetch.js` as subprocess via `spawnSync` with `COPILOT_HOME` pointing to tmpdir.
Uses `COPILOT_QUOTA_MOCK_RESPONSE` env var to avoid real network calls.

Cases:
- Valid mock response → `quota-cache.json` written correctly, `consecutive_failures = 0`
- Malformed mock response → failure counter increments, no cache file written
- Network timeout simulation (mock returns special sentinel) → failure counter increments
- Circuit already open → script exits without writing, counters unchanged
- Failure count reaches threshold → `circuit_open_until` set to ~1hr from now
- Success after previous failures → `consecutive_failures` reset to 0, `circuit_open_until` cleared
- `GH_TOKEN` env var used when set (no `gh auth token` call)

### `tests/quota-widget.test.js` — widget rendering, real temp dirs
Calls widget functions directly with constructed `sessionData` objects.

Cases:
- `quota_remaining`: fresh data / stale data (tilde) / no data (null) / overage (remaining < 0)
- `quota_remaining`: powerline vs plain mode
- `quota_used`: various percentages / no data
- `overage_status`: count > 0 / count = 0 returns null / powerline mode
- All three widgets: `show_label` option respected

### `tests/quota-api-contract.test.js` — live API contract validation
Skipped automatically when `gh auth token` is unavailable (uses node:test's `skip` option).

When it runs:
- Calls `gh auth token` + real fetch
- Validates every field we depend on exists with correct type:
  - `quota_snapshots` is an object
  - At least one snapshot has `has_quota: true` OR an `unlimited: true` snapshot exists
  - `premium_interactions` (or first `has_quota: true` snapshot): `entitlement` (number), `remaining` (number), `quota_remaining` (number), `percent_remaining` (0–100), `overage_permitted` (boolean), `overage_count` (number)
  - `quota_reset_date_utc` matches ISO 8601 date pattern
- Reports missing/wrong-type fields with exact key paths, not just "schema invalid"
- This test acts as the early-warning system for API changes

---

## Verification

1. Run all existing tests: `node --test tests/*.test.js` — all still pass
2. Run new unit tests: `node --test tests/quota-api.test.js tests/quota-widget.test.js`
3. Run subprocess tests: `node --test tests/quota-fetch.test.js`
4. Run contract test (needs `gh auth token`): `node --test tests/quota-api-contract.test.js`
5. Manual end-to-end: restart Copilot CLI session → `quota-cache.json` appears within 5s
6. Add `quota_remaining` widget to `~/.copilot/plugin-data/burnrate-copilot/config.json` → verify display
7. Simulate failure: set `COPILOT_QUOTA_MOCK_RESPONSE=invalid` via env, run quota-fetch.js manually 3× → verify circuit opens, statusline renders with stale data (no hang)

---

## What Does NOT Change

- `session_cost` / `session_credits` widgets — still sourced from per-turn `nano_aiu` (unchanged)
- Session file schema for `last_known_nano_aiu`, `last_known_cost`, `last_known_tokens` — unchanged
- JSONL records still written on session end — used for per-project/Jira breakdown, not MTD display
- Statusline render latency — zero added latency (background spawn is non-blocking)

## What Changes in Existing Widgets

**`mtd_cost`** — primary source changes from JSONL sum to API cache:
1. API cache present and fresh → `(entitlement - quota_remaining) / 100` → USD
2. API cache stale → same calculation, tilde prefix
3. API cache absent → fall back to existing JSONL + session nano_aiu sum (current behaviour)

**`mtd_credits`** — primary source changes from JSONL sum to API cache:
1. API cache present and fresh → `entitlement - quota_remaining` → credit value
2. API cache stale → same, tilde prefix
3. API cache absent → fall back to existing JSONL + session nano_aiu × 100 sum (current behaviour)

`getMtdAndProjected()` in `pricing.js` becomes the fallback path only, not the primary.
