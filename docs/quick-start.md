# burnrate-copilot — Quick Start

**burnrate-copilot** is a GitHub Copilot CLI plugin that makes your AI spend visible in real time. It shows per-session cost and a month-to-date total directly in the statusline footer — updated every turn — and stores everything locally with no external calls.

![](images/Statusline.png)

---

## Requirements

- GitHub Copilot CLI (v1.0.56 or higher)
- Node.js ≥ 18 on your PATH (most developers already have this)

---

## Installation

**1. Install the plugin**

In the Copilot CLI chat:

```
/plugin install https://github.com/upld-internal/burnrate-copilot.git
```

**2. Start a new session**

The plugin auto-configures itself on the first session start. It writes the `statusLine` entry to `~/.copilot/settings.json` and the statusline will appear from the first turn.

**3. (Optional) Customize your layout**

Use `/burnrate:configure` to choose a preset (Minimal, Standard, Full) or build a custom widget layout. Configuration is saved to `~/.copilot/burnrate-copilot/config.json`. You can also modify this file directly.

---

## What the statusline shows

| Segment | Description |
|---|---|
| `Session: $0.08` | Cost for the current session |
| `May: $6.21 (~$41/mo)` | MTD total across all completed sessions + linear projection |
| `8m` | Session elapsed time |
| `Sonnet 4.6` | Active model |
| `28%` | Context window utilization (used / total) |
| `main ✎` | Git branch + indicator when there are uncommitted changes |

The Jira ticket widget (`JIRA-4821`) also appears when your branch follows a `[PROJ-NNN]` naming convention — see [Jira Integration](#jira-integration) below.

---

## Skills

All skills are invoked inside the Copilot CLI chat. The `/burnrate:` prefix is the namespace for this plugin.

### `/burnrate:burnrate-cost-summary`

Monthly spend report grouped by project, model, and optionally Jira ticket. Reads from `~/.copilot/burnrate-copilot/monthly/YYYY-MM.jsonl`.

```
/burnrate:burnrate-cost-summary              ← current month
/burnrate:burnrate-cost-summary 2026-04      ← specific month
/burnrate:burnrate-cost-summary 2026-05 2026-05-01 2026-05-15   ← date range
```

Output includes: total cost, token breakdown, by-model table, top expensive sessions, and per-project grouping.

---

### `/burnrate:burnrate-optimize`

Analyzes your last 30 days of session records and produces a scored health report (0–100) with prioritized recommendations. Checks include model mix efficiency, high-cost outlier sessions, session length distribution, and tool usage patterns.

```
/burnrate:burnrate-optimize            ← last 30 days
/burnrate:burnrate-optimize --days 7   ← last 7 days
```

---

### `/burnrate:burnrate-report`

Packages your session data, config, and debug log into a zip file for bug reports or support requests.

```
/burnrate:burnrate-report                             ← writes burnrate-report-YYYY-MM-DD.zip to cwd
/burnrate:burnrate-report --output /tmp/report.zip    ← custom path
```

---

### `/burnrate:configure`

Interactive statusline configurator. Choose from Minimal, Standard, Full, or Powerline presets, or assemble a custom layout widget by widget. Writes to `~/.copilot/burnrate-copilot/config.json`.

---

### `/burnrate:setup`

Manually (re-)configures the `statusLine` entry in `~/.copilot/settings.json` to point at the plugin script. Run this if auto-configure didn't fire on first start.

---

## Jira Integration

When you work on a branch named after a Jira ticket (e.g., `feature/PLAT-4821-new-auth`), burnrate-copilot automatically attributes session cost to that ticket. The attribution flows through to `/burnrate:burnrate-cost-summary` and the monthly JSONL, enabling per-ticket cost reporting.

**Optional config** in `~/.copilot/burnrate-copilot/config.json`:

```json
{
  "jira": {
    "project_keys": ["PLAT", "ENG", "INFRA"]
  }
}
```

Without `project_keys`, any `[A-Z]+-\d+` pattern in the branch name is treated as a Jira key. Setting `project_keys` restricts detection to only those prefixes.

To show the active ticket in the statusline, add the `jira_ticket` widget to your segments:

```json
{
  "segments": [
    { "widget": "jira_ticket", "show_source": true }
  ]
}
```

---

## Data directory

All plugin data lives in `~/.copilot/burnrate-copilot/`. Nothing is written outside this directory and nothing is sent over the network.

```
~/.copilot/burnrate-copilot/
  config.json               ← widget layout and theme configuration
  sessions/<id>.json        ← per-session state (deleted at clean SessionEnd)
  monthly/YYYY-MM.jsonl     ← completed session records (one line per session)
  debug/hooks.jsonl         ← hook debug log (when COPILOT_HUD_DEBUG=1)
```

---

## Debug mode

Set `COPILOT_HUD_DEBUG=1` to capture full hook payloads to `debug/hooks.jsonl`:

```bash
COPILOT_HUD_DEBUG=1 gh copilot chat "hello"
node scripts/show-hook-debug.js
```

Useful for verifying field names in Copilot hook payloads when debugging unexpected behavior.

---

## Fallback behavior

The statusline never crashes or shows blank. If something goes wrong:

| Condition | Display |
|---|---|
| Normal operation | `$0.08 session \| May: $6.21 (~$41/mo)` |
| No session file yet | `$0.00 session \| May: $6.21` |
| Monthly file unreadable | `$0.08 session \| May: ?` |
| Stdin parse failure | `[burnrate error]` |

If you see `? session`, check that `sessions/` contains a file for the current session ID:

```bash
ls ~/.copilot/burnrate-copilot/sessions/
```

---

## Custom config directory

If your Copilot config is not at `~/.copilot/`, set `COPILOT_HOME`:

```bash
export COPILOT_HOME=/custom/path/.copilot
```

---

## Contributing

The plugin is plain Node.js with no runtime npm dependencies. See [CLAUDE.md](../CLAUDE.md) for architecture details, the stdin JSON schema, and session file schemas. The test suite lives in `tests/` and each file can be run directly with `node tests/<file>.test.js`.
