# copilot-hud — Quick Start

## What is this?

**copilot-hud** is a GitHub Copilot CLI plugin that tracks your session spend in real time. It shows per-session cost and a month-to-date total directly in the statusline footer — updated every turn — and stores everything locally with no external calls.

## How it works

On every turn, Copilot CLI pipes session data (including running token totals) to the statusline command configured in `~/.copilot/config.json`. The plugin computes cost from token deltas × pricing, writes it to a local session file, and rolls it into a monthly JSONL log at session end.

---

## Requirements

- GitHub Copilot CLI (`gh copilot` or standalone)
- Node.js ≥ 18 on your `PATH`
- macOS, Linux, or Windows
- Default Copilot config directory (`~/.copilot/`). Override with `COPILOT_HOME` env var if you use a custom location.

---

## Installation

**1. Install the plugin**

```bash
gh copilot plugin install <path-to-copilot-hud>
```

**2. Configure the statusline**

Add to `~/.copilot/config.json`:

```json
{
  "experimental": true,
  "statusLine": {
    "type": "command",
    "command": "node /path/to/copilot-hud/scripts/statusline.js"
  }
}
```

The plugin will auto-configure this on first session start if not already set. See `commands/configure.md` for full configuration options.

---

## Included skills

### `/burnrate-cost-summary`

Shows a cost breakdown for the current month (or any month you specify), grouped by project and optionally by Jira ticket.

**Example usage:**
- `/burnrate-cost-summary` — current month summary
- `/burnrate-cost-summary 2026-04` — April summary
- `/burnrate-cost-summary 2026-05 2026-05-01 2026-05-15` — date range

The output includes total cost, by-model breakdown, and by-project grouping. Use `--by-jira` for per-ticket attribution (requires Jira integration to be active).

---

### `/burnrate-optimize`

Analyzes the last 30 days of session records for cost and efficiency patterns. Produces a scored health report with actionable recommendations.

**Example usage:**
- `/burnrate-optimize` — analyze last 30 days
- `/burnrate-optimize --days 7` — last 7 days only

Checks include: high-cost session outliers, model mix efficiency, session length distribution, and tool usage patterns (once Phase 2 telemetry is active).

---

### `/burnrate-report`

Packages your session data and config into a zip file for bug reports or support requests.

**Example usage:**
- `/burnrate-report` — writes `burnrate-report-YYYY-MM-DD.zip` to the current directory
- `/burnrate-report --output /tmp/my-report.zip` — custom output path

---

## Jira Integration

When you work on a branch named after a Jira ticket (e.g., `feature/PLAT-4821-new-auth`), copilot-hud automatically attributes session cost to that ticket.

**Optional config** in `~/.copilot/copilot-hud/config.json`:

```json
{
  "jira": {
    "project_keys": ["PLAT", "ENG", "INFRA"]
  }
}
```

When `project_keys` is set, only matching keys are detected. Without it, any `[A-Z]+-\d+` pattern in the branch name is treated as a Jira key.

The `jira_ticket` widget can be added to your statusline segments:

```json
{
  "segments": [
    { "widget": "jira_ticket", "show_source": true }
  ]
}
```

---

## Data directory

All plugin data lives in `~/.copilot/copilot-hud/`:

```
~/.copilot/copilot-hud/
  pricing.json              ← model pricing table (override rates here)
  config.json               ← widget layout and theme configuration
  sessions/<id>.json        ← per-session state (deleted at clean SessionEnd)
  monthly/YYYY-MM.jsonl     ← completed session records
  debug/hooks.jsonl         ← hook debug log (when COPILOT_HUD_DEBUG=1)
```

---

## Debug mode

Set `COPILOT_HUD_DEBUG=1` to capture full hook payloads to `debug/hooks.jsonl`:

```bash
COPILOT_HUD_DEBUG=1 gh copilot chat "hello"
node scripts/show-hook-debug.js
```

This is useful for verifying that hook field names match what the plugin expects.

---

## Custom config directory

If you use a non-standard Copilot config location, set `COPILOT_HOME`:

```bash
export COPILOT_HOME=/custom/path/.copilot
```
