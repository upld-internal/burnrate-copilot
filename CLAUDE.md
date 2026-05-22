# burnrate-copilot — GitHub Copilot CLI cost display

## Project goal

Build a real-time cost display plugin for GitHub Copilot CLI, mirroring the functionality of the Claude Code cost display at `~/Projects/cost-display`. Display session spend, MTD total, context window usage, model, and git status in the Copilot CLI statusline footer.

## Existing Claude Code implementation to adapt from

`~/Projects/cost-display` — the working Claude Code version. **Do not modify this project** (cost accuracy validation in progress until 2026-05-18). Read it for patterns; build the Copilot version independently here.

Key files to understand before starting:
- `scripts/pricing.js` — `computeCost`, `getMtdAndProjected`, `loadPricing`
- `scripts/compositor.js` — how session data is loaded and passed to widgets
- `scripts/session-start.js` — how session files are written and orphans recovered
- `scripts/session-end.js` — how completed sessions are appended to monthly JSONL
- `scripts/themes.js` — ANSI color helpers (reuse directly)
- `scripts/widgets/cost.js`, `context.js`, `git.js`, `session.js` — widget rendering (mostly reusable)

## Copilot CLI statusline mechanism

Configured in `~/.copilot/config.json`:

```json
{
  "experimental": true,
  "statusLine": {
    "type": "command",
    "command": "node /path/to/scripts/statusline.js"
  }
}
```

On every turn, Copilot pipes a JSON object to the script's stdin. The script writes its rendered output to stdout. Copilot displays it in the footer.

## Copilot stdin JSON schema (confirmed from burnrate-copilot source)

```json
{
  "session_id": "session-abc123",
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
    "total_input_tokens": 24100,
    "total_output_tokens": 8420,
    "total_cache_read_tokens": 5200,
    "total_cache_write_tokens": 1100,
    "last_call_input_tokens": 3200,
    "last_call_output_tokens": 820
  },
  "cost": {
    "total_api_duration_ms": 45000,
    "total_duration_ms": 300000,
    "total_premium_requests": 3,
    "total_lines_added": 42,
    "total_lines_removed": 5
  }
}
```

**Critical difference from Claude Code:** There is no `cost.total_cost_usd` field. Copilot does not provide a pre-computed USD amount. Cost must be computed from the four token types in `context_window`.

Claude Code cache field names vs Copilot cache field names:
| | Claude Code | Copilot CLI |
|---|---|---|
| Cache writes | `cache_creation_input_tokens` | `total_cache_write_tokens` |
| Cache reads | `cache_read_input_tokens` | `total_cache_read_tokens` |

The `computeSessionCost` function in `~/Projects/cost-display/scripts/pricing.js` uses Claude's field names. Write a Copilot-specific variant using Copilot's field names.

## Hook system

Configured in `hooks.json` at the plugin root.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-start.js", "timeoutSec": 5}],
    "sessionEnd":   [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-end.js",   "timeoutSec": 5}]
  }
}
```

`PLUGIN_ROOT` is set by Copilot CLI's hook execution environment (same pattern as `CLAUDE_PLUGIN_ROOT` in Claude Code).

SessionStart stdin provides: `session_id`, `model.id`, `model.display_name`, `cwd`.
SessionEnd stdin provides: `session_id`. (No cost or token data — same limitation as Claude Code.)

**`model` is an object in Copilot** (`model.id`), unlike Claude Code's SessionStart which sends `model` as a plain string. No `typeof` check needed.

## Session file schema

Write to `~/.copilot/burnrate-copilot/sessions/<session_id>.json`:

```json
{
  "session_id": "session-abc123",
  "started_at": "2026-05-13T10:00:00Z",
  "start_month": "2026-05",
  "model_id": "claude-sonnet-4.6",
  "project": "my-app",
  "project_id": "-Users-you-projects-my-app",
  "snapshot": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_cache_write_tokens": 0,
    "total_cache_read_tokens": 0
  }
}
```

The `snapshot` is a zero baseline (tokens start at 0 each session). On each statusline turn, the compositor computes cost as (current totals − snapshot). Write `last_known_cost`, `last_known_model`, `last_known_at` back to the session file on every turn — these are used by SessionEnd and orphan recovery.

## Monthly JSONL schema (shared with claude-hud)

Append to `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`:

```json
{"id":"session-abc123","date":"2026-05-13","start_month":"2026-05","cost_usd":0.082341,"model":"claude-sonnet-4.6","project":"my-app","project_id":"-Users-you-projects-my-app"}
```

This schema is identical to claude-hud's JSONL schema, enabling a future unified cost summary.

## Data directory

All plugin data lives in `~/.copilot/burnrate-copilot/`:

```
~/.copilot/burnrate-copilot/
  pricing.json              ← model pricing table (input/output/cache rates)
  sessions/<id>.json        ← per-session state (deleted at clean SessionEnd)
  monthly/YYYY-MM.jsonl     ← completed session records
```

## Pricing table

`pricing.json` uses the same schema as claude-hud but with Copilot model IDs and Anthropic direct API rates (not Bedrock). Model IDs in Copilot stdin appear to use the format `claude-sonnet-4.6` (without the `us.anthropic.` Bedrock prefix).

**Verify the exact model IDs from a real Copilot session before publishing the pricing table.** Log the first `model.id` value you see and confirm it matches the keys in pricing.json.

## Recommended build order

1. Understand plugin.json, hooks.json, and stdin schema
2. Copy `~/Projects/cost-display/scripts/pricing.js` → `scripts/pricing.js`, replace `getClaudeConfigDir` with `getCopilotConfigDir` (defaults to `~/.copilot`)
3. Copy `~/Projects/cost-display/scripts/themes.js` → `scripts/themes.js` (no changes needed)
4. Copy widgets: `context.js`, `git.js`, `session.js`, `custom.js` → `scripts/widgets/` (no changes needed)
5. Adapt `cost.js` — the widget reads `sessionData.sessionCost` which is compositor-computed; no changes needed if compositor is correct
6. Write `scripts/compositor.js` — adapt from cost-display version; replace `nativeCost` logic with token-delta computation using Copilot field names
7. Write `scripts/session-start.js` — same pattern as cost-display, model is already an object (no `typeof` check)
8. Write `scripts/session-end.js` — same pattern as cost-display (use `last_known_cost` from session file)
9. Write `scripts/statusline.js` — same entry point pattern as cost-display
10. Write `plugin.json`, `hooks.json`, `pricing.json`
11. Test with `COPILOT_CONFIG_DIR` pointing to a test directory

## What's NOT needed for v1

- The statusline conflict detection from claude-hud's session-start.js (no equivalent in Copilot)
- The launcher file indirection (that's a Claude plugin marketplace workaround)
- The `/cost-summary` skill install (can add later)
- The `account` widget (Copilot-specific account detection is different)
- The `block_timer` widget (Copilot doesn't have Claude's 5-hour rate limit)
