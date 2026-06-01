# Cost Calculation

How burnrate-copilot computes USD cost from GitHub Copilot's AI Credits billing data.

---

## The Formula

```
cost_usd = total_nano_aiu / 100,000,000,000
```

Where `total_nano_aiu` is GitHub's authoritative billing field from the statusline stdin (`ai_used.total_nano_aiu`), representing nano-AI-Usage-Units for the current session.

**Conversion:** 1 AI credit = 1,000,000,000 nano-AIU = $0.01 USD

This is a session-cumulative value (monotonically increasing). No token math, no rates table, no approximation — GitHub bills by AI credits and that's what we show.

---

## Real-Time Cost (Statusline — Every Turn)

The compositor (`scripts/compositor.js`) extracts cost directly from `ai_used.total_nano_aiu` on every turn:

```js
const nanoAiu = stdinData.ai_used?.total_nano_aiu;  // e.g. 6987975000
const costUsd = nanoAiu / 100_000_000_000;           // → $0.0699
```

The result is written to `session.last_known_nano_aiu` and `session.last_known_cost` in the session file every turn.

Token counts (`last_known_tokens`) are also preserved for cache efficiency analysis in `/burnrate-optimize`.

---

## Final Cost (Session End — 2-Level Fallback)

When a session ends, `session-end.js` uses:

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

---

## Month-to-Date and Projected

`getMtdAndProjected(monthKey, dataDir)` sums all `cost_usd` from the current month's JSONL, then projects:

```
projected = (mtd / dayOfMonth) × daysInMonth
```

Displayed in the `mtd_cost` widget.
