# burnrate-copilot — GitHub Copilot CLI cost display

## Installation and uninstallation

### Installing

In the Copilot CLI chat:

```
/plugin install git@github.com:upld-internal/burnrate-copilot.git
```

The installer:
1. Caches the plugin to `~/.copilot/installed-plugins/_direct/<slug>/`
2. Appends an entry to `installedPlugins` in **`~/.copilot/config.json`** (managed automatically — do not edit by hand):
   ```json
   {
     "name": "burnrate-copilot",
     "marketplace": "",
     "version": "0.1.0",
     "installed_at": "<ISO timestamp>",
     "enabled": true,
     "cache_path": "/Users/you/.copilot/installed-plugins/_direct/<slug>",
     "source": { "source": "url", "url": "git@github.com:upld-internal/burnrate-copilot.git" }
   }
   ```
3. Writes the `statusLine` key to **`~/.copilot/settings.json`** (user settings file):
   ```json
   "statusLine": {
     "type": "command",
     "command": "/Users/you/.copilot/installed-plugins/_direct/<slug>/scripts/statusline.js"
   }
   ```

**No `experimental` flag and no `featureFlags: STATUS_LINE` are required.** The statusLine feature works with a plain `settings.json` entry.

### Uninstalling

```sh
copilot plugin uninstall burnrate-copilot
```

This removes the `installedPlugins` entry from `config.json`, removes the `statusLine` key from `settings.json`, and deletes the cached plugin directory.

## Copilot CLI statusline mechanism

On every turn, Copilot runs the `statusLine` command and pipes a JSON object to its stdin. The script writes its rendered output to stdout. Copilot displays it in the footer.

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
    "sessionStart":        [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-start.js",  "timeoutSec": 5}],
    "userPromptSubmitted": [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/user-prompt.js",    "timeoutSec": 5}],
    "preToolUse":          [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/pre-tool-use.js",   "timeoutSec": 5}],
    "postToolUse":         [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/post-tool-use.js",  "timeoutSec": 5}],
    "sessionEnd":          [{"type": "command", "command": "node ${PLUGIN_ROOT}/scripts/session-end.js",    "timeoutSec": 5}]
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

## Monthly JSONL schema (shared with burnrate-claude)

Append to `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`:

```json
{"id":"session-abc123","date":"2026-05-13","start_month":"2026-05","cost_usd":0.082341,"model":"claude-sonnet-4.6","project":"my-app","project_id":"-Users-you-projects-my-app"}
```

This schema is identical to burnrate-claude's JSONL schema, enabling a future unified cost summary.

## Data directory

All plugin data lives in `~/.copilot/burnrate-copilot/`:

```
~/.copilot/burnrate-copilot/
  pricing.json              ← model pricing table (input/output/cache rates)
  sessions/<id>.json        ← per-session state (deleted at clean SessionEnd)
  monthly/YYYY-MM.jsonl     ← completed session records
```

## Pricing table

`pricing.json` uses the same schema as burnrate-claude but with Copilot model IDs and GitHub Copilot AI Credits rates. Model IDs in Copilot stdin use the format `claude-sonnet-4.6` (without the `us.anthropic.` Bedrock prefix).
