# burnrate-copilot

Real-time cost and context display for GitHub Copilot CLI. Shows per-session token spend, month-to-date total, context window usage, model, and git branch — directly in the Copilot CLI statusline, updated every turn.

```
$0.08 session  |  May: $6.21 (~$41/mo)  |  claude-sonnet-4.6  |  28%  |  8m  |  main ✎
```

## How it works

GitHub Copilot CLI supports a custom statusline via `statusLine.command` in `~/.copilot/settings.json`. On every turn, Copilot pipes a JSON object to the configured script's stdin. The script renders its output to stdout and Copilot displays it in the footer.

This plugin:
1. Reads `context_window` token counts from the Copilot stdin JSON
2. Computes session cost from token deltas against a pricing table
3. Accumulates completed-session costs in a monthly JSONL file
4. Displays session cost, MTD total, context %, model, and git info

## Relationship to burnrate-claude

`burnrate-copilot` and `burnrate-claude` (sibling folder) are parallel implementations of the same concept:

| | burnrate-copilot | burnrate-claude |
|---|---|---|
| Platform | GitHub Copilot CLI | Claude Code CLI |
| Config | `~/.copilot/settings.json` → `statusLine.command` | `~/.claude/settings.json` → `statusLine.command` |
| Cost source | Computed from `context_window` token breakdown | `cost.total_cost_usd` from stdin (native) |
| Cache tokens | `total_cache_read_tokens` / `total_cache_write_tokens` | Handled automatically via native cost |
| Pricing | Anthropic direct API rates (or GitHub Models rates) | AWS Bedrock cross-region rates |
| Data dir | `~/.copilot/burnrate-copilot/` | `~/.claude/bedrock-costs/` |
| Hook system | `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse` | `SessionStart`, `SessionEnd`, `PostToolUse` |

Both plugins use the same JSONL schema for monthly cost records, enabling a future unified `cost-summary` command across both tools.

## Key difference from burnrate-claude

Claude Code provides `cost.total_cost_usd` directly in the stdin JSON — a pre-computed dollar figure that handles cache tokens automatically. Copilot does **not** include a USD cost field. Instead, Copilot provides a full token breakdown in `context_window`:

```json
{
  "context_window": {
    "total_input_tokens": 24100,
    "total_output_tokens": 8420,
    "total_cache_read_tokens": 5200,
    "total_cache_write_tokens": 1100
  }
}
```

This plugin computes cost from these four token types using a pricing table. This is actually more transparent than the Claude approach — all token types are visible.

## Architecture

1. **SessionStart hook** — writes a session file with model ID, project, start time, zero-baseline token snapshot
2. **statusLine command** — computes cost from token delta vs baseline, writes `last_known_cost` back to session file, renders display
3. **SessionEnd hook** — reads `last_known_cost`, appends record to `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`
4. **Orphan recovery** — on next SessionStart, recovers costs from sessions that exited without firing SessionEnd
