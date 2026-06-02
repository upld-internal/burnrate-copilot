# Quota API

burnrate-copilot fetches monthly quota data from GitHub's internal Copilot API and uses it as the primary source for MTD cost and credit displays.

---

## Why This Exists

The `ai_used.total_nano_aiu` field in the statusline stdin is authoritative for session cost, but it resets to zero each session. Summing JSONL records gives an MTD figure, but only covers sessions recorded since the plugin was installed — a mid-month install shows incorrect totals.

The `GET https://api.github.com/copilot_internal/user` endpoint provides quota data directly from GitHub's billing system: `entitlement`, `remaining`, `quota_remaining`, and `quota_reset_date_utc` for `premium_interactions`. This is the same data shown on the GitHub billing dashboard and covers the full billing period regardless of when the plugin was installed.

Because the endpoint is undocumented, all access is treated as potentially unreliable. The circuit breaker, cache, and fallback chain ensure a broken API never blocks the statusline or adds render latency.

---

## Data Model

**Units confirmed (2026-06-02):** `entitlement: 3000` = 3000 AI credits/month. 1 AI credit = $0.01 USD.

Cross-verified: API returned `quota_remaining = 252.6`, matching GitHub billing UI (`used = 2747.4 credits = $27.47`).

**Conversion:**
```
mtd_credits_used = entitlement - quota_remaining   // e.g. 3000 - 252.6 = 2747.4
mtd_cost_usd     = mtd_credits_used / 100          // e.g. 2747.4 / 100 = $27.47
```

---

## Architecture

```
session-start.js          statusline.js (every turn)
      │                          │
      │  spawn (detach+unref)    │  after stdout written
      ▼                          ▼
quota-fetch.js ──────────► maybeSpawnRefresh()
  (async)                        │  spawn only if stale + circuit closed + no pending
      │
      ▼
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

**Key constraint:** `compositor.js → render()` is synchronous. The Copilot CLI pipe protocol has no concept of async completion. All quota data must be read from a cache file synchronously. Network requests happen in a **detached background child process** that is spawned and immediately unref'd — it never blocks the render path.

**Cache TTL:** 5 minutes (configurable via `CACHE_TTL_MS` in `quota-api.js`)

---

## Cache File

**Location:** `~/.copilot/plugin-data/burnrate-copilot/quota-cache.json`

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

When the cache is stale (older than 5 minutes) but present, it is still used for display with a tilde prefix to indicate staleness (e.g., `~252 left`).

---

## State File

**Location:** `~/.copilot/plugin-data/burnrate-copilot/quota-state.json`

```json
{
  "consecutive_failures": 0,
  "last_attempt_at": null,
  "last_success_at": "2026-06-02T13:00:00Z",
  "circuit_open_until": null,
  "refresh_pending_since": null
}
```

Written atomically via tmp+rename to prevent corruption from concurrent processes.

---

## Circuit Breaker

- **Failure threshold:** 3 consecutive failures → circuit opens
- **Cooldown:** `circuit_open_until = now + 1 hour` when circuit opens
- **Auto-close:** circuit closes automatically when `circuit_open_until` is in the past
- **Pending guard:** `refresh_pending_since` prevents duplicate background spawns; treated as stale after 30 seconds (handles crash of background process without cleanup)
- **Reset:** any success resets `consecutive_failures = 0` and clears `circuit_open_until`

A background spawn is triggered only when ALL of the following are true:
1. Cache is missing OR older than the TTL
2. Circuit is not open
3. No pending refresh (or pending entry is older than 30 seconds)

---

## Fallback Chain (compositor.js)

1. `quota-cache.json` exists and `fetched_at` is within TTL → use it, `sd.quotaStale = false`
2. `quota-cache.json` exists but stale → use it, `sd.quotaStale = true`, tilde prefix in UI
3. No cache → try `session.last_known_quota` → use it, `sd.quotaStale = true`
4. Nothing → `sd.hasQuota = false` → quota widgets return `null` (hidden)

`last_known_quota` is written back to the session file on every compositor turn, so a single successful fetch persists across the session even if the cache file is later deleted.

---

## Files

### `scripts/quota-api.js`

Pure synchronous utilities. No network calls, no child_process. Imported by compositor.js and statusline.js.

**Exports:**
- `readQuotaCache(dataDir)` → `{ data, stale, ageMs }` | `{ data: null }`
- `readQuotaState(dataDir)` → state object (defaults if missing/malformed)
- `writeQuotaState(dataDir, state)` → void (atomic write via tmp+rename)
- `isCircuitOpen(state)` → boolean
- `shouldRefresh(cacheResult, state)` → boolean
- `parseApiResponse(json)` → normalized quota data | null (validates schema)
- `findPremiumSnapshot(quotaSnapshots)` → snapshot | null (name match, then first `has_quota: true`)

**Constants:** `CACHE_TTL_MS` (5 min), `CIRCUIT_OPEN_DURATION_MS` (1 hr), `FAILURE_THRESHOLD` (3), `REFRESH_PENDING_TIMEOUT_MS` (30 s)

### `scripts/quota-fetch.js`

Async standalone script. Always run as a detached background process — never required directly.

**Flow:**
1. Read `quota-state.json`; if circuit open, exit 0
2. Mark `refresh_pending_since = now` in state
3. Resolve auth token: `GH_TOKEN` env → `gh auth token` CLI
4. If `COPILOT_QUOTA_MOCK_RESPONSE` env is set: skip network, parse that value instead
5. `fetch(url, { signal: AbortController(3000ms) })`
6. Parse + validate with `parseApiResponse()`
7. **Success:** write `quota-cache.json`, reset `consecutive_failures`, clear `circuit_open_until`
8. **Failure:** increment `consecutive_failures`, open circuit if at threshold
9. Clear `refresh_pending_since`, write `quota-state.json`, exit

**Environment hooks (for testing):**
- `GH_TOKEN` — use directly, skip `gh auth token` call
- `COPILOT_QUOTA_MOCK_RESPONSE` — JSON string; skip network entirely, parse this instead

---

## MTD Source Precedence

MTD display now reads from the quota API cache as primary source. This supersedes the JSONL sum as the primary source for `mtd_cost` and `mtd_credits` widgets.

| Priority | Source | Condition |
|---|---|---|
| 1 | Quota API cache (fresh) | `quota-cache.json` present and within TTL |
| 2 | Quota API cache (stale) | `quota-cache.json` present but older than TTL |
| 3 | JSONL sum + current session | Cache absent — existing behaviour, unchanged |

The JSONL record stream continues to be written on session end and is used for per-project and per-Jira breakdowns in `/burnrate:burnrate-cost-summary`. It is not the primary MTD display source.

---

## Tests

| File | What it covers |
|---|---|
| `tests/quota-api.test.js` | Unit tests for all `quota-api.js` exports — no network |
| `tests/quota-fetch.test.js` | Subprocess integration: runs `quota-fetch.js` with mock responses via `COPILOT_QUOTA_MOCK_RESPONSE` |
| `tests/quota-widget.test.js` | Widget rendering for `quota_remaining`, `quota_used`, `overage_status` |
| `tests/quota-api-contract.test.js` | Live API contract validation — auto-skipped when `gh auth token` is unavailable |

The contract test (`quota-api-contract.test.js`) is the early-warning system for undocumented API changes. It validates every field the plugin depends on, reporting exact key paths for missing or wrong-type fields rather than a generic "schema invalid" message.
