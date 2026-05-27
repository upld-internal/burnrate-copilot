# Cost Calculation

How burnrate-copilot turns raw token counts into USD cost estimates.

---

## The Formula

```
cost_usd = (input_tokens / 1M × input_rate)
         + (output_tokens / 1M × output_rate)
         + (cache_write_tokens / 1M × cache_write_rate)
         + (cache_read_tokens / 1M × cache_read_rate)
```

Applied per-model when multi-model data is available.

---

## Pricing Table

**Source:** `pricing.json` at repo root (bundled) or `~/.copilot/burnrate-copilot/pricing.json` (user override, takes precedence).

**Rates:** GitHub Copilot AI Credits per 1M tokens (1 credit = $0.01 USD). Effective June 2026.

Example entries:

| Model | Input | Output | Cache Write | Cache Read |
|-------|------:|-------:|------------:|-----------:|
| claude-haiku-4.5 | $1.00 | $5.00 | $1.25 | $0.10 |
| claude-sonnet-4.6 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-opus-4.7 | $5.00 | $25.00 | $6.25 | $0.50 |
| gpt-5.5 | $5.00 | $30.00 | — | $0.50 |
| gpt-5.4-mini | $0.40 | $1.60 | — | $0.04 |
| gpt-4.1 | $2.00 | $8.00 | — | $0.50 |

OpenAI/Google models have `cache_write: 0` (only Anthropic charges for prompt caching storage).

### Staleness Warning

If `pricing.json._meta.last_verified` is >60 days old, a warning is emitted to stderr (never to stdout/statusline).

---

## Real-Time Cost (Statusline — Every Turn)

The compositor (`scripts/compositor.js`) computes cost on every turn using the **model_tokens map**:

### How It Works

1. **Snapshot baseline:** `session-start.js` writes `snapshot: { all zeros }` to the session file.
2. **Each turn:** The statusline receives cumulative `total_*_tokens` from Copilot.
3. **Delta calculation:** `delta = current_tokens - previous_turn_tokens` (clamped to ≥0).
4. **Model attribution:** Delta is attributed to `model.id` from the current stdin.
5. **Per-model accumulation:** `model_tokens[modelId] += delta` stored in session file.
6. **Cost computation:** For each model in `model_tokens`, apply that model's rates, sum all.

```
model_tokens = {
  "claude-sonnet-4.6": { input: 5000000, output: 40000, cache_write: 100000, cache_read: 4500000 },
  "gpt-5.3-codex":     { input: 500000,  output: 5000,  cache_write: 0,      cache_read: 0 }
}
```

### Why model_tokens, Not Single-Model?

Sessions use multiple models (parent + subagents). A single model's rate applied to all tokens causes up to **65% error** on individual sessions. The `model_tokens` map tracks per-model deltas across turns.

**Limitation:** The statusline only knows the *currently active* model (`model.id`). Subagent tokens flow into the cumulative totals but are attributed to whatever model is "current" at that turn. This is approximate but much better than single-model pricing. The authoritative per-model breakdown comes from `session.shutdown.modelMetrics` at session end.

---

## Final Cost (Session End — 4-Level Fallback)

When a session ends, `session-end.js` computes the definitive cost using a fallback chain:

### Strategy 1: Multi-Model (events.jsonl)

```
parseShutdownMetrics(sessionId) → modelMetrics
computeMultiModelCost(modelMetrics, pricingTable) → { total, perModel }
```

- **Source:** `session.shutdown.modelMetrics` in events.jsonl
- **Accuracy:** Authoritative — exact per-model tokens from Copilot's own accounting
- **Availability:** Only on normal session exit (session.shutdown event present)
- **Field:** `cost_method: "multi_model"`

### Strategy 2: model_tokens (Session File)

```
session.model_tokens → per-model totals from statusline tracking
```

- **Source:** Session file updated every statusline turn
- **Accuracy:** Good — real per-model deltas, but model attribution is approximate for subagent tokens
- **Availability:** Survives Ctrl+C (last turn's data persists)
- **Field:** `cost_method: "model_tokens"`

### Strategy 3: Single-Model (Aggregate)

```
session.last_known_tokens × pricing[session.last_known_model]
```

- **Source:** Aggregate token totals + last known model
- **Accuracy:** Approximate — applies one model's rate to all tokens
- **Availability:** Available if any statusline turn ran
- **Field:** `cost_method: "single_model"`

### Strategy 4: Last Known Cost (Cached)

```
session.last_known_cost
```

- **Source:** Cached cost from the last statusline computation
- **Accuracy:** Whatever the statusline last computed
- **Availability:** Available if any statusline turn ran
- **Field:** `cost_method: "last_known"`

---

## Orphan Recovery

If `sessionEnd` never fires (crash, Ctrl+C, system kill), session files become "orphans." On the next `sessionStart`, orphan recovery runs:

1. Scans `sessions/` for files not matching the current session
2. For each orphan, attempts cost computation using the same 4-level fallback
3. Writes a monthly JSONL record with `"recovered": true`
4. Deletes the orphan session file

---

## What's Included in modelMetrics

Verified empirically across 19+ sessions:

| Source | Included in modelMetrics? |
|--------|:------------------------:|
| Parent agent tokens | ✅ |
| Subagent tokens | ✅ |
| Compaction API call tokens | ✅ |
| Tool execution tokens | ✅ |

**Key conclusion:** `modelMetrics` is the single source of truth. Compaction costs and subagent costs are NOT additive — they're already inside the total. The `compaction_cost` and `subagents_detail` fields in monthly JSONL are informational breakdowns showing *where* cost went, not additional charges.

---

## Month-to-Date and Projected

`getMtdAndProjected(monthKey, dataDir)` sums all `cost_usd` from the current month's JSONL, then projects:

```
projected = (mtd / dayOfMonth) × daysInMonth
```

Displayed in the `mtd_cost` widget.
