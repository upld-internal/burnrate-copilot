# burnrate-copilot — Quick Start

**burnrate-copilot** is a GitHub Copilot CLI plugin that makes your AI spend visible in real time. It shows per-session cost and a month-to-date total directly in the statusline footer — updated every turn — and stores everything locally with no external calls.

```
$0.08 session  |  May: $6.21 (~$41/mo)  |  claude-sonnet-4.6  |  28%  |  8m  |  main ✎
```

The plugin computes cost from the token breakdown Copilot CLI pipes to the statusline on every turn, multiplies by the current GitHub AI Credits rates, and accumulates completed sessions into a monthly JSONL log. No network calls, no telemetry, nothing leaves your machine.

![](images/Statusline.png)

---

## Requirements

- GitHub Copilot CLI (standalone or via `gh copilot`)
- Node.js ≥ 18 on your `PATH`
- macOS or Linux (Windows support planned)
- A GitHub SSH key configured for the `upld-internal` org (required for installation — see below)

---

## Installation

**1. Install via SSH**

In the Copilot CLI chat:

```
/plugin install git@github.com:upld-internal/burnrate-copilot.git
```

HTTPS installation is blocked by SAML SSO on the `upld-internal` org. SSH is the correct path.

> **Need a GitHub SSH key?** [Set one up here](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) — it takes 5 minutes and eliminates passwords for all future GitHub interactions.

**2. Start a new session**

The plugin auto-configures itself on the first session start. It writes the `statusLine` entry to `~/.copilot/settings.json` and the statusline will appear from the first turn.

**3. (Optional) Customize your layout**

Use `/burnrate:configure` to choose a preset (Minimal, Standard, Full) or build a custom widget layout. Configuration is saved to `~/.copilot/burnrate-copilot/config.json`.

---

## What the statusline shows

| Segment | Description |
|---|---|
| `$0.08 session` | Cost for the current session, computed from token deltas × pricing |
| `May: $6.21 (~$41/mo)` | Month-to-date total across all completed sessions + linear projection |
| `claude-sonnet-4.6` | Active model ID |
| `28%` | Context window utilization (used / total) |
| `8m` | Session elapsed time |
| `main ✎` | Git branch + indicator when there are uncommitted changes |

The Jira ticket widget (`PLAT-4821`) also appears when your branch follows a `[PROJECT-NNN]` naming convention — see [Jira Integration](#jira-integration) below.

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
  pricing.json              ← model pricing table (override rates here)
  config.json               ← widget layout and theme configuration
  sessions/<id>.json        ← per-session state (deleted at clean SessionEnd)
  monthly/YYYY-MM.jsonl     ← completed session records (one line per session)
  debug/hooks.jsonl         ← hook debug log (when COPILOT_HUD_DEBUG=1)
```

---

## Pricing maintenance

Model pricing is sourced from [GitHub's official billing docs](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and stored in `pricing.json`. It does not update automatically.

```bash
node scripts/update-pricing.js          # diff local vs current GitHub docs
node scripts/update-pricing.js --apply  # write changes to pricing.json
```

To verify which model IDs are active on your plan:

```bash
bash scripts/verify-model-ids.sh          # scan historical sessions
bash scripts/verify-model-ids.sh --test   # also send a live test prompt per model
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
| No session file yet | `? session \| May: $6.21` |
| Monthly file unreadable | `$0.08 session \| May: ?` |
| Pricing not found for model | Session cost shows `?` |
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
