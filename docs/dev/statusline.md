---
title: Statusline & Widgets
parent: Developer Guide
nav_order: 4
---

# Statusline & Widgets

The statusline is burnrate-copilot's primary user-facing output. It renders in the Copilot CLI footer on every turn.

---

## How It Works

1. Copilot CLI calls `statusline.js` (configured via `~/.copilot/settings.json`).
2. `statusline.js` reads JSON from stdin, passes it to `compositor.js`.
3. The compositor loads config and session data. It reads `ai_used.total_nano_aiu` for cost, updates the session file (cost, tokens, Jira attribution, turn_tokens), then renders widgets in sequence.
4. Output goes to stdout — Copilot displays it in the footer.

### What the compositor writes to the session file (every turn)

| Field | Purpose |
|-------|---------|
| `last_known_tokens` | Cumulative token snapshot for the next delta computation |
| `last_known_model` | Model ID in use this turn |
| `last_known_cost` | Running session cost estimate |
| `last_known_nano_aiu` | Last known `ai_used.total_nano_aiu` value (for orphan recovery) |
| `last_known_at` | ISO timestamp of last compositor write |
| `last_known_quota` | Snapshot of latest quota data (fallback if `quota-cache.json` is missing) |
| `turn_tokens` | Per-turn token breakdown array (capped at 100 entries) |
| `jira_costs` | Jira cost attribution delta for the active ticket |

---

## Configuration

**File:** `~/.copilot/plugin-data/burnrate-copilot/config.json`

```json
{
  "powerline": false,
  "theme": "default",
  "separator": "│",
  "segments": [
    { "widget": "model_name", "short": true, "show_label": true },
    { "widget": "separator" },
    { "widget": "context_window", "format": "full", "show_label": true },
    { "widget": "separator" },
    { "widget": "git_branch" },
    { "widget": "git_status" },
    { "widget": "newline" },
    { "widget": "session_cost", "show_label": true },
    { "widget": "session_duration" },
    { "widget": "separator" },
    { "widget": "mtd_cost" }
  ]
}
```

### Top-Level Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `powerline` | boolean | `false` | Enable Nerd Font powerline arrows between segments |
| `theme` | string | `"default"` | Color theme: `default`, `minimal`, `nord`, `dracula`, `catppuccin` |
| `separator` | string | `"│"` | Separator character in non-powerline mode |
| `segments` | array | (see above) | Ordered list of widgets to render |
| `jira` | object | `null` | Jira configuration (`project_keys`, `base_url`) |

### Segment Object

Each entry in `segments` is:

```json
{ "widget": "<widget_name>", ...options }
```

Options vary per widget (documented below). All widgets accept:
- `show_label` (boolean) — prefix output with a label like "Ctx:" or "Session:"
- Powerline mode is injected as `_powerline: true` by the compositor (not user-set).

### Multi-Line Layouts

Use `{ "widget": "newline" }` to start a new row. All segments before the newline appear on line 1, all after on line 2.

---

## Widget Catalog

### Cost Widgets (`widgets/cost.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `session_cost` | `Session $4.23` | `show_label` (default true) |
| `session_credits` | `Credits: 423.10` | `show_label` (default true) |
| `mtd_cost` | `May $142.50 (~$285/mo)` | `show_projected` (default true) |
| `mtd_credits` | `Jun 14250 (~28500/mo)` | `show_projected` (default true) |
| `quota_remaining` | `252 left · resets Jul 1` | `show_reset_date` (default true), `show_label` (default false) |
| `quota_used` | `2748/3000 (91.6%)` | `show_label` (default false) |
| `overage_status` | `+3 overage` | `show_label` (default false) — returns null when `overage_count = 0` |

`session_cost` color-codes: default (<$1), yellow ($1–5), red (>$5).

`mtd_cost` primary source is the quota API cache (`(entitlement - quota_remaining) / 100`). Falls back to JSONL sum when cache is absent. Stale cache values are prefixed with `~`.

`quota_remaining` and `quota_used` require the quota API to have fetched at least once. They return `null` (hidden) when no quota data is available. Stale values get a `~` prefix.

`overage_status` is only visible when `overage_count > 0`; returns `null` otherwise.

---

### Context Widgets (`widgets/context.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `context_window` | `Ctx 85K / 200K (42%)` | `format`: `"percent"` \| `"bar"` \| `"tokens"` \| `"full"`, `show_label` |
| `premium_requests` | `⟐ 3` | `show_label`, `show_zero` |
| `token_breakdown` | `in:24.1K out:8.4K cache:6.3K` | `show_label`, `show_cache` (default true) |
| `output_speed` | `42 t/s` | `show_label` |
| `last_call` | `↳ 3.2K / 820` | `show_label` |
| `cache_breakdown` | `R:5.2K W:1.1K` | `show_label` |

`context_window` formats:
- `percent` — `42%`
- `bar` — `████████░░ 42%`
- `tokens` — `85K / 200K`
- `full` — `85K / 200K (42%)`

Color thresholds: green (<50%), yellow (50–70%), red (>70%).

---

### Session Widgets (`widgets/session.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `model_name` | `Sonnet 4.6 3x (high)` | `short` (default true), `show_badge` (default true), `show_label` |
| `session_duration` | `(47m)` or `(2h 3m)` | `show_label` |
| `session_name` | `feature-auth` | `show_label` |
| `lines_changed` | `+42/-3` | `show_label` |

`model_name` parses Copilot's `display_name` to produce short form:
- `claude-sonnet-4.6 (3x) (high)` → `Sonnet 4.6 3x (high)`
- `gpt-5.4-mini` → `GPT-5.4 mini`

---

### Jira Widget (`widgets/jira.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `jira_ticket` | `PROJ-123 ⎇` (clickable link) | `show_source`, `show_label`, `color`, `link` (default true), `base_url` |

Renders an OSC 8 terminal hyperlink to the Jira ticket. Source icons: `●` explicit, `⎇` branch, `↩` commit, `⬡` atlassian_mcp.

---

### Git Widgets (`widgets/git.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `git_branch` | `main ↑2 ↓1` | `show_ahead_behind` (default true) |
| `git_status` | `✎ 3 ✚ 1` | `show_label` |

`git_branch` includes ahead/behind counts when tracking a remote.

---

### Tool Widgets (`widgets/tools.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `tool_activity` | `✓ ⌨ Bash: ls ×3  ◐ ✎ Edit: auth.js` | `max_tools` (default 4), `show_label` |
| `agent_activity` | `◐ [explore] Analyzing codebase (12s…)` | `max_agents` (default 3) |

Status icons: `✓` success, `✗` failure, `◐` running, `⊘` denied.
Tool icons: `⌨` bash, `✎` edit, `◉` view, `✚` create, `⊛` glob/grep, `⟳` task.

---

### System Widgets (`widgets/system.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `cwd` | `burnrate-copilot` | `depth` (path segments, default 1), `show_label` |

---

### Custom Widgets (`widgets/custom.js`)

| Widget | Output Example | Options |
|--------|---------------|---------|
| `custom_text` | `My Label` | `text` (required), `color`, `bold` |
| `custom_symbol` | `🔥` | `symbol` (required), `color` |
| `custom_command` | *(output of command)* | `command` (required), `timeout` (ms, default 1000) |
| `separator` | ` │ ` | `char` |
| `newline` | *(line break)* | — |

`custom_command` runs a shell command with the full stdin JSON piped in. Useful for integrating external scripts.

---

## Themes

Themes control powerline segment colors. Available:

| Theme | Description |
|-------|-------------|
| `default` | Gray gradient (237→243) |
| `minimal` | No backgrounds — plain text with spaces |
| `nord` | Nord palette blues/teals |
| `dracula` | Dracula purples/pinks |
| `catppuccin` | Catppuccin pastels |

In non-powerline mode, themes have no effect (widgets use standard ANSI: bold, dim, green, yellow, red).

---

## Powerline Mode

Set `"powerline": true` in config. Requires a Nerd Font / Powerline-patched terminal font.

- Segments get cycling background colors from the theme
- Powerline arrow glyphs (``/`\uE0B0`) are injected between segments
- `separator` widgets are suppressed (arrows replace them)
- `newline` starts a new powerline row
