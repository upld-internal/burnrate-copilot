# burnrate-copilot — Developer Guide

> Real-time cost tracking, usage analytics, and workflow tooling for GitHub Copilot CLI.

---

## Table of Contents

| Page | Description |
|------|-------------|
| [Architecture Overview](#architecture-overview) | High-level system design and data flow |
| [Data Ingestion](./data-ingestion.md) | All data sources: hooks, events.jsonl, statusline stdin, quota API |
| [Cost Calculation](./cost-calculation.md) | How AI Credits billing works: nano-AIU to USD, MTD sources, fallbacks |
| [Quota API](./quota-api.md) | MTD billing from GitHub's internal quota endpoint: cache, circuit breaker, fallback chain |
| [Statusline & Widgets](./statusline.md) | Custom statusline renderer, widget catalog, configuration |
| [Hook Scripts](./hooks.md) | Each hook handler: what it does, when it fires, what it writes |
| [Monthly Records](./monthly-records.md) | JSONL schema, fields, and query patterns |
| [Data Points & Optimize Relevance](./data-points.md) | Every tracked field with optimize skill applicability |
| [Skills & Commands Reference](./skills.md) | All five commands: invocation, workflow, script behavior, widget catalog |
| [Copilot CLI Internals](./copilot-internals.md) | Experimental mode, feature flags, plugin architecture |

---

## Purpose

burnrate-copilot is a GitHub Copilot CLI plugin that:

1. **Surfaces real-time cost** — Per-session token spend and USD cost displayed in the statusline every turn.
2. **Tracks aggregated spend** — Month-to-date totals, projected monthly cost, breakdowns by project, model, and Jira ticket.
3. **Structured cost reports** —  The `/burnrate-cost-summary` skill provides a cost report by model, project, and Jira ticket. 
4. **Teaches efficient AI usage** — The `/burnrate-optimize` skill analyzes usage patterns and produces actionable recommendations for reducing cost while maintaining output quality.
5. **Delivers team workflows** - Delevery mechanism for shared team configuration and workflows (Jira, Confluence, Git, Tests, etc)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Copilot CLI (parent process)                                    │
│                                                                 │
│  Every turn:                                                    │
│    stdin JSON ──▶ statusline.js ──▶ stdout (rendered footer)    │
│                                                                 │
│  Lifecycle hooks (JSON on stdin):                               │
│    sessionStart ──▶ session-start.js                            │
│    userPromptSubmitted ──▶ user-prompt.js                       │
│    preToolUse ──▶ pre-tool-use.js                               │
│    postToolUse ──▶ post-tool-use.js                             │
│    subagentStart ──▶ subagent-start.js                          │
│    subagentStop ──▶ subagent-stop.js                            │
│    preCompact ──▶ pre-compact.js                                │
│    sessionEnd ──▶ session-end.js                                │
└─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ Session File     │  │ hud-state.json │  │ Monthly JSONL        │
│ (live state)     │  │ (tool/agent    │  │ (completed sessions) │
│                  │  │  activity)     │  │                      │
│ sessions/<id>    │  │ ~/.copilot/    │  │ monthly/YYYY-MM.jsonl│
│ .json            │  │ hud-state.json │  │                      │
└──────────────────┘  └────────────────┘  └──────────────────────┘
```

### Data directory layout

```
~/.copilot/plugin-data/burnrate-copilot/
├── config.json             # User display configuration (widgets, theme)
├── sessions/<id>.json      # Live session state (deleted at clean exit)
├── monthly/YYYY-MM.jsonl   # Completed session records (append-only)
├── quota-cache.json        # Cached quota API response (TTL: 5 min)
├── quota-state.json        # Circuit breaker state for quota API
└── debug/
    ├── hooks.jsonl         # Hook debug log (COPILOT_HUD_DEBUG=1)
    └── stdin-debug.jsonl   # StatusLine stdin log (COPILOT_HUD_DEBUG=1)
```

---

## Key Design Principles

1. **Never crash Copilot.** All hook scripts and the statusline catch errors silently. A broken plugin must never block the user's workflow.
2. **Graceful degradation.** Cost falls back from `last_known_nano_aiu` to `last_known_cost`. Both survive Ctrl+C. Quota display falls back from fresh cache → stale cache → session snapshot → hidden.
3. **Synchronous render path.** `statusline.js → compositor.js → render()` is fully synchronous. All data is read from local files; network requests happen in detached background processes.
4. **Authoritative billing.** Session cost is read directly from `ai_used.total_nano_aiu` — GitHub's own billing figure. MTD cost is read from the quota API cache. No token math, no per-model rate tables.

---

## Source Layout

```
burnrate-copilot/
├── scripts/
│   ├── statusline.js          # Entry point: Copilot calls this every turn
│   ├── compositor.js          # Renders all widgets, manages session state
│   ├── pricing.js             # getMtdAndProjected (reads monthly JSONL)
│   ├── events-parser.js       # Parse events.jsonl (enriched fields from shutdown)
│   ├── session-start.js       # SessionStart hook handler
│   ├── session-end.js         # SessionEnd hook handler (writes monthly JSONL)
│   ├── user-prompt.js         # UserPromptSubmitted hook
│   ├── pre-tool-use.js        # PreToolUse hook (tool counting, subagent tracking)
│   ├── post-tool-use.js       # PostToolUse hook (file extensions, tool results)
│   ├── subagent-start.js      # SubagentStart hook
│   ├── subagent-stop.js       # SubagentStop hook
│   ├── pre-compact.js         # PreCompact hook (compaction counter)
│   ├── session-file.js        # Shared helpers: updateSession, buildTelemetryFields
│   ├── state.js               # Atomic hud-state.json read/write
│   ├── paths.js               # Path resolution (COPILOT_HOME, data dirs)
│   ├── themes.js              # ANSI color palettes, powerline helpers
│   ├── jira-detector.js       # Git branch → Jira key extraction
│   ├── jira-attribution.js    # Per-turn cost attribution to Jira tickets
│   ├── statusline-config.js   # Auto-configure settings.json on first run
│   ├── quota-api.js           # Synchronous quota cache/state utilities (no network)
│   ├── quota-fetch.js         # Async background fetcher (run as detached child process)
│   └── widgets/               # One file per widget category
│       ├── cost.js            # session_cost, mtd_cost
│       ├── context.js         # context_window, premium_requests, token_breakdown, etc.
│       ├── session.js         # model_name, session_duration, lines_changed
│       ├── jira.js            # jira_ticket (clickable link)
│       ├── git.js             # git_branch, git_status
│       ├── tools.js           # tool_activity, agent_activity
│       ├── system.js          # cwd
│       └── custom.js          # custom_text, custom_symbol, custom_command, separator, newline
├── hooks.json                 # Hook registrations (Copilot reads this)
├── plugin.json                # Plugin metadata
├── skills/                    # Copilot skills (/burnrate:*)
├── commands/                  # CLI commands
├── tests/                     # Node.js test runner tests
└── docs/                      # Documentation
```

---

## Quick Reference: Running Tests

```bash
node --test tests/*.test.js
```

All tests use Node.js built-in test runner (no dependencies). Tests mock the filesystem via `COPILOT_HOME` env var pointing to a temp directory.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `COPILOT_HOME` | Override `~/.copilot` — used by tests and non-standard installs |
| `COPILOT_HUD_DEBUG` | Set to `1` to enable hook and stdin debug logging |
| `PLUGIN_ROOT` | Set by Copilot CLI hook executor — absolute path to plugin install |
| `GH_TOKEN` | GitHub auth token used by `quota-fetch.js` instead of calling `gh auth token` |
| `COPILOT_QUOTA_MOCK_RESPONSE` | JSON string injected as mock API response in `quota-fetch.js` (skips network) |

---

## Contributing

1. Read this guide and the relevant subpages for the area you're changing.
2. Run `node --test tests/*.test.js` before and after changes.
3. Hook scripts must exit within 5 seconds (Copilot's timeout).
4. Never write to stdout from hook scripts (only statusline.js writes to stdout).
5. All errors must be caught — an uncaught exception crashes the user's Copilot session.
