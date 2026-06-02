---
title: Cost Calculation
parent: Developer Guide
nav_order: 2
---

# Cost Calculation

How burnrate-copilot computes USD cost from GitHub Copilot's billing data.

---

## Session Cost (Real-Time)

```
cost_usd = total_nano_aiu / 100,000,000,000
```

`total_nano_aiu` is GitHub's authoritative billing field from the statusline stdin (`ai_used.total_nano_aiu`), representing nano-AI-Usage-Units for the current session.

**Conversion:** 1 AI credit = 1,000,000,000 nano-AIU = $0.01 USD

This is a session-cumulative value (monotonically increasing). No token math, no rates table, no approximation — GitHub bills by AI credits and that's what we show.

The compositor (`scripts/compositor.js`) extracts cost directly from `ai_used.total_nano_aiu` on every turn:

```js
const nanoAiu = stdinData.ai_used?.total_nano_aiu;  // e.g. 6987975000
const costUsd = nanoAiu / 100_000_000_000;           // → $0.0699
```

The result is written to `session.last_known_nano_aiu` and `session.last_known_cost` in the session file every turn.

Token counts (`last_known_tokens`) are also preserved for cache efficiency analysis in `/burnrate-optimize`.

---

## Month-to-Date Cost (Primary: Quota API)

MTD cost and credits come from the GitHub Copilot quota API as the primary source. This is the same data shown on the GitHub billing dashboard and covers the full billing period regardless of when the plugin was installed.

**Conversion from API response:**
```
mtd_credits_used = entitlement - quota_remaining   // e.g. 3000 - 252.6 = 2747.4
mtd_cost_usd     = mtd_credits_used / 100          // e.g. 2747.4 / 100 = $27.47
```

The quota cache is refreshed in the background every 5 minutes. See [Quota API](./quota-api.md) for the full architecture including the circuit breaker and fallback chain.

**MTD source priority:**

| Priority | Source | Condition |
|---|---|---|
| 1 | Quota API cache (fresh) | `quota-cache.json` present and within TTL |
| 2 | Quota API cache (stale) | Present but older than TTL — displayed with `~` prefix |
| 3 | JSONL sum + current session | Cache absent — fallback to existing JSONL sum |

**Fallback formula (JSONL path):**
```
projected = (mtd / dayOfMonth) × daysInMonth
```
`getMtdAndProjected(monthKey, dataDir)` in `pricing.js` sums all `cost_usd` from the current month's JSONL. This path is only taken when the quota cache is absent.

---

## Final Session Cost (Session End)

When a session ends, `session-end.js` resolves final cost via a 2-level fallback:

### Strategy 1: AI Credits (ai_credits)

```
session.last_known_nano_aiu / 100_000_000_000
```

- **Source:** Last statusline turn's `ai_used.total_nano_aiu`, stored in session file
- **Accuracy:** Authoritative — GitHub's own billing figure
- **Availability:** Available after any statusline turn
- **Field:** `cost_method: "ai_credits"`

### Strategy 2: Last Known Cost (last_known)

```
session.last_known_cost
```

- **Source:** Cached cost from the last statusline computation
- **Availability:** Available after any statusline turn
- **Field:** `cost_method: "last_known"`

Zero-turn sessions (user opens Copilot then immediately Ctrl+C before any statusline fires) correctly produce `cost_usd: 0`.

---

## Orphan Recovery

If `sessionEnd` never fires (crash, Ctrl+C, system kill), session files become "orphans." On the next `sessionStart`, orphan recovery runs:

1. Scans `sessions/` for files not matching the current session
2. For each orphan, attempts cost using the same 2-level fallback
3. Writes a monthly JSONL record with `"recovered": true`
4. Deletes the orphan session file
