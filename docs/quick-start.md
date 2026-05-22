# burnrate-copilot — Quick Start

## What is this?

**burnrate-copilot** is a GitHub Copilot CLI plugin that tracks your session spend in real time. It shows per-session cost and a month-to-date total directly in the statusline footer — updated every turn — and stores everything locally with no external calls.

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

**1. Install via SSH (recommended)**

If you have an ssh key configured for github, installation is simple. In the Copilot CLI chat, use:

```bash
 /plugin install git@github.com:upld-internal/burnrate-copilot.git

```

Our Github organizations require that SAML SSO be authorized for the upld-internal org. As of now, this is preventing Copilot CLI plugin installs via HTTPS. We are investigating whether this can be resolved, but ssh is better anyways, so use that.

> [!INFO] Need a Git SSH key?
[SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/about-ssh) is the preferred (and easiest) way to interact with git. If you do not have an ssh key configured for use with GitHub, do so [here](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) now. It only takes 5 minutes and you will never need to provide a password or API token again. :) 


**2. Configuring your statusline**

The plugin will auto-configure this on first session start if not already set. See `commands/configure.md` for full configuration options.

Add to `~/.copilot/settings.json`:

---

## Included skills

### `/burnrate:burnrate-cost-summary`

Shows a cost breakdown for the current month (or any month you specify), grouped by project and optionally by Jira ticket.

**Example usage:**
- `/burnrate:burnrate-cost-summary` — current month summary
- `/burnrate:burnrate-cost-summary 2026-04` — April summary
- `/burnrate:burnrate-cost-summary 2026-05 2026-05-01 2026-05-15` — date range

The output includes total cost, by-model breakdown, and by-project grouping. Use `--by-jira` for per-ticket attribution (requires Jira integration to be active).

---

### `/burnrate:burnrate-optimize`

Analyzes the last 30 days of session records for cost and efficiency patterns. Produces a scored health report with actionable recommendations.

**Example usage:**
- `/burnrate:burnrate-optimize` — analyze last 30 days
- `/burnrate:burnrate-optimize --days 7` — last 7 days only

Checks include: high-cost session outliers, model mix efficiency, session length distribution, and tool usage patterns.

---

### `/burnrate:burnrate-report`

Packages your session data and config into a zip file for bug reports or support requests.

**Example usage:**
- `/burnrate:burnrate-report` — writes `burnrate-report-YYYY-MM-DD.zip` to the current directory
- `/burnrate:burnrate-report --output /tmp/my-report.zip` — custom output path

---

### `/burnrate:configure`

Interactively configure the statusline widget layout. Choose from Minimal, Standard, Full, or Powerline presets, or build a custom layout widget by widget. Writes to `~/.copilot/burnrate-copilot/config.json`.

---

### `/burnrate:setup`

Configure GitHub Copilot CLI to point its statusline at the burnrate-copilot script. Run this once after installation if auto-configure did not fire.

---

## Jira Integration

When you work on a branch named after a Jira ticket (e.g., `feature/PLAT-4821-new-auth`), burnrate-copilot automatically attributes session cost to that ticket.

**Optional config** in `~/.copilot/burnrate-copilot/config.json`:

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

All plugin data lives in `~/.copilot/burnrate-copilot/`:

```
~/.copilot/burnrate-copilot/
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

This captures payloads for all hook types (`sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`) and is useful for verifying that field names match what the plugin expects.

---

## Pricing maintenance

Model pricing is stored locally in `~/.copilot/burnrate-copilot/pricing.json` and does not update automatically.

**To check for pricing changes:**

```bash
node scripts/update-pricing.js
```

Fetches the [GitHub Copilot billing docs](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) and diffs against your local `pricing.json`. If prices have changed, run with `--apply` to write the update:

```bash
node scripts/update-pricing.js --apply
```

**To verify model IDs on your plan:**

```bash
bash scripts/verify-model-ids.sh          # historical scan only (no API calls)
bash scripts/verify-model-ids.sh --test   # also tests each model with a live prompt
```

This reports which models are CONFIRMED (seen in interactive sessions), ACCESSIBLE (responded to a test prompt), or NO_SESSION (not available on your plan or invalid ID).

---

## Custom config directory

If you use a non-standard Copilot config location, set `COPILOT_HOME`:

```bash
export COPILOT_HOME=/custom/path/.copilot
```
