# burnrate-copilot — Quick Start

Real-time cost and context display for GitHub Copilot CLI. Shows per-session token spend, month-to-date total, context window usage, model, git branch, and Jira; directly in the statusline, updated every turn.

![](images/Statusline.png)

---

## Requirements

- GitHub Copilot CLI (v1.0.56 or higher). Use `/update` to get latest.
- Node.js ≥ 18 on your PATH (most will already have this)

---

## Installation

**1. Install the plugin**

In the Copilot CLI chat:

```
/plugin install https://github.com/upld-internal/burnrate-copilot.git
```

**2. Restart Copilot CLI**

The plugin configures itself automatically on the first session start. **Start a new session twice** — the statusline writes its configuration on your first session and becomes active from the second onward.

If the statusline still doesn't appear after restarting, run `/burnrate:setup` to configure it manually.

**3. (Optional) Customize your layout**

Use `/burnrate:configure` to choose a preset (Minimal, Standard, Full) or build a custom widget layout. Configuration is saved to `~/.copilot/plugin-data/burnrate-copilot/config.json`. You can also modify this file directly — see [Configuring widgets](#configuring-widgets) below.

### Update to New Plugin Version

To download the latest plugin version, in the Copilot CLI chat:

```
/plugin update burnrate-copilot
```

### Uninstall

To un-install, in the Copilot CLI chat:

```
/plugin uninstall burnrate-copilot
```

---

## What the statusline shows

| Segment | Description |
|---|---|
| `Sonnet 4.6 · high` | Active model and effort |
| `Ctx: 48.2K / 160K (30%)` | Context window utilization (used / total) & percent |
| `main ✎` | Git branch & dirty indicator (uncommitted local changes) |
| `Session: $11.13 (2h 4m)` | Cost for the current session & elapsed time |
| `Jun $11.13 (~$323/mo)` | MTD total across all completed sessions + linear projection |
| `8m` | Session elapsed time |

The Jira ticket widget (`JIRA-4821`) also appears when your branch follows a `[PROJ-NNN]` naming convention — see [Jira Integration](#jira-integration) below.

---

## Skills

All skills are invoked inside the Copilot CLI chat. The `/burnrate:` prefix is the namespace for this plugin.

### `/burnrate:burnrate-cost-summary`

Monthly spend report grouped by project, model, and optionally Jira ticket. Reads from `~/.copilot/plugin-data/burnrate-copilot/monthly/YYYY-MM.jsonl`.

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

Interactive statusline configurator. Choose from Minimal, Standard, Full, or Powerline presets, or assemble a custom layout widget by widget. Writes to `~/.copilot/plugin-data/burnrate-copilot/config.json`.

---

### `/burnrate:setup`

Manually (re-)configures the `statusLine` entry in `~/.copilot/settings.json` to point at the plugin script. Run this if auto-configure didn't fire on first start.

---

## Configuring widgets

The statusline layout is controlled by `~/.copilot/plugin-data/burnrate-copilot/config.json`.

**Interactive setup** — run inside the Copilot CLI chat:

```
/burnrate:configure
```

Pick a preset (Minimal, Standard, Full, Powerline) or assemble a custom layout widget by widget.

**Manual editing** — open `config.json` directly and modify the `segments` array. Each entry names a widget and sets its options:

```json
{
  "powerline": false,
  "theme": "default",
  "segments": [
    { "widget": "model_name", "short": true },
    { "widget": "separator" },
    { "widget": "context_window", "format": "full" },
    { "widget": "separator" },
    { "widget": "session_cost" },
    { "widget": "newline" },
    { "widget": "git_branch" },
    { "widget": "git_status" }
  ]
}
```

Use `{ "widget": "newline" }` to split the statusline across multiple rows. Set `"powerline": true` (requires a [Nerd Font](https://www.nerdfonts.com/)) to replace separators with arrow glyphs and add segment background colors from the selected theme (`default`, `minimal`, `nord`, `dracula`, `catppuccin`).

For a full reference of all widgets, options, Powerline mode, and themes, see **[docs/user/widgets.md](user/widgets.md)**.

---

## Jira Integration

When you work on a branch named after a Jira ticket (e.g., `feature/JIRA-4821-new-auth`), burnrate-copilot automatically attributes session cost to that ticket. The attribution flows through to `/burnrate:burnrate-cost-summary` and the monthly JSONL, enabling per-ticket cost reporting.

**Optional config** in `~/.copilot/plugin-data/burnrate-copilot/config.json`:

```json
{
  "jira": {
    "project_keys": ["JIRA", "ENG", "INFRA"]
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

All plugin data lives in `~/.copilot/plugin-data/burnrate-copilot/`. Nothing is written outside this directory and nothing is sent over the network.

```
~/.copilot/plugin-data/burnrate-copilot/
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
ls ~/.copilot/plugin-data/burnrate-copilot/sessions/
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
