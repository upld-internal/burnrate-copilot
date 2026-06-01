# burnrate-copilot — Skills and Commands Reference

burnrate-copilot exposes user-facing functionality through two mechanisms: **commands** (Copilot CLI slash commands) and **skills** (companion Node.js scripts invoked by commands). Both live in the plugin root.

---

## Architecture: Commands vs Skills

| Mechanism | Location | How invoked | What it is |
|-----------|----------|-------------|------------|
| Command | `commands/<name>.md` | `/burnrate:<name>` in Copilot CLI | Markdown file with AI instructions Copilot CLI follows |
| Skill script | `skills/<name>/scripts/<name>.js` | Called by a command's Bash block | Node.js script producing structured output |

Commands that run a script (cost-summary, optimize, report) are thin wrappers: the command file's only job is to invoke the script and tell the AI how to present the output. Commands that are pure AI interactions (configure, setup) contain the entire workflow as natural-language instructions.

---

## Table of Contents

| Command | Slash command | Script? | Description |
|---------|--------------|---------|-------------|
| [`burnrate-cost-summary`](#burnrate-cost-summary) | `/burnrate:burnrate-cost-summary` | ✅ | Monthly cost report by project, model, and Jira ticket |
| [`burnrate-optimize`](#burnrate-optimize) | `/burnrate:burnrate-optimize` | ✅ | Session telemetry audit with cost pattern findings |
| [`burnrate-report`](#burnrate-report) | `/burnrate:burnrate-report` | ✅ | Bug report zip packager |
| [`configure`](#configure) | `/burnrate:configure` | ❌ | Interactive widget layout configurator |
| [`setup`](#setup) | `/burnrate:setup` | ❌ | Installation configurator and verifier |

---

## burnrate-cost-summary

**Command file:** `commands/burnrate-cost-summary.md`  
**Script:** `skills/burnrate-cost-summary/scripts/summarize-costs.js`  
**Output format reference:** `skills/burnrate-cost-summary/reference/OUTPUT_FORMAT.md`

### What it does

Reads monthly JSONL records from `~/.copilot/burnrate-copilot/monthly/` and prints a formatted cost summary. By default shows the current month grouped by project and Jira ticket.

### Invocation

```
/burnrate:burnrate-cost-summary
```
Or by trigger phrase: "show my costs", "cost summary", "how much have I spent", "monthly spend", "usage report".

Arguments: `2026-04` (specific month) or `2026-05 2026-05-01 2026-05-15` (month with date range filter).

### Script behavior

- Reads all `.jsonl` files from `~/.copilot/burnrate-copilot/monthly/`
- Filters by month and optional date range
- Groups by: total, by-project (`--by-project`), by-Jira (`--by-jira`), by-model
- Outputs formatted tables matching `OUTPUT_FORMAT.md`

---

## burnrate-optimize

**Command file:** `commands/burnrate-optimize.md`  
**Script:** `skills/burnrate-optimize/scripts/optimize.js`

### What it does

Analyzes monthly JSONL telemetry records for cost patterns and usage inefficiencies. Produces a prioritized health report with copy-paste fix recommendations.

### Invocation

```
/burnrate:burnrate-optimize
```
Or by trigger phrase: "optimize my usage", "find token waste", "why am I spending so much", "analyze my sessions".

Arguments: `--days 7` (restrict to last N days), `--project foo` (filter to one project).

### Patterns detected

The optimize script analyzes the monthly JSONL telemetry (not Claude Code transcripts) for the following patterns:

| Pattern | Finding title |
|---------|---------------|
| High use of expensive models | `<N>% of cost from expensive models` |
| Single project dominating spend | `<project> accounts for <N>% of total spend` |
| High average turns per session | `High turn count: avg <N>, p95 <N> turns/session` |
| Slow turn intervals | `High p95 turn interval: <time>` |
| Heavy view/read without edits | `High view-to-edit ratio: <N> views vs <N> edits` |
| Subagent cost concentration | `Subagents account for <N>% of total spend` |
| Low cache hit rate | `Low cache hit rate: <N>%` |
| Extended thinking overuse | `Extended thinking: <N> reasoning tokens (<N>% of total)` |
| Compaction overhead | `Compaction overhead: $<N> (<N>% of total)` |
| Top-5 session spend concentration | `Top 5 sessions = <N>% of total spend` |

> **Difference from burnrate-claude:** burnrate-copilot's optimize script works from JSONL telemetry (structured session summaries). burnrate-claude's optimize script reads Claude Code transcript `.jsonl` files directly and can detect per-turn patterns such as junk directory reads, duplicate file reads, CLAUDE.md bloat, missing Bash output limits, and unused MCP servers.

---

## burnrate-report

**Command file:** `commands/burnrate-report.md`  
**Script:** `skills/burnrate-report/scripts/report.js`

### What it does

Packages burnrate-copilot data into a `.zip` file for submitting bug reports or sharing diagnostics.

### Invocation

```
/burnrate:burnrate-report
```
Or by trigger phrase: "report a bug", "something is wrong with burnrate", "send debug info", "create a support report".

Optional argument: `--output /path/to/file.zip` (defaults to `burnrate-report-YYYY-MM-DD.zip` in the current directory).

### Contents of the zip

| File | Description |
|------|-------------|
| `monthly/*.jsonl` | All monthly cost records |
| `sessions/*.json` | Any active (non-cleaned) session files |
| `config.json` | User widget configuration |
| `settings.json` | Copilot CLI settings (API keys and tokens **redacted**) |
| `sysinfo.json` | OS, Node.js version, plugin version |
| `debug/hooks.jsonl` | Hook debug log (if `BURNRATE_DEBUG=1` was set) |

> **Difference from burnrate-claude:** burnrate-copilot's report includes `debug/hooks.jsonl` when present. burnrate-claude's equivalent does not include a hooks debug log (it uses `stdin-debug.jsonl` instead, which is included if present).

---

## configure

**Command file:** `commands/configure.md`  
**Script:** None (AI-driven)

### What it does

Interactively configures the burnrate-copilot statusline widget layout. Reads the current `config.json`, walks the user through preset or custom selection, previews the layout, then writes the new config.

### Invocation

```
/burnrate:configure
```

### Workflow

1. **Resolve paths** — Finds `COPILOT_HOME` (env var or `~/.copilot`) and locates `config.json` at `$COPILOT_DIR/burnrate-copilot/config.json`.
2. **Show current config** — Displays powerline mode, theme, separator, and widget count.
3. **Offer presets:**

   | Preset | Description |
   |--------|-------------|
   | **Minimal** | One-line: model, context %, duration |
   | **Standard** (default) | Two-line: model + context + git on line 1; cost + duration + MTD on line 2 |
   | **Full** | One-line: all widgets including token breakdown, speed, premium requests, git, tools |
   | **Powerline** | Standard layout with Nerd Font powerline arrows; prompts for theme |
   | **Custom** | Fine-grained: separator, powerline toggle, per-widget yes/no |
   | **Keep current** | Exit without writing |

4. **Theme options** (Powerline or Custom + powerline): `default`, `nord`, `dracula`, `catppuccin`, `minimal`
5. **Preview** — Always shows a text layout preview before asking to confirm.
6. **Write** — Saves to `~/.copilot/burnrate-copilot/config.json`. Changes take effect on the next turn (no restart).

### Available widgets

| Widget | Description |
|--------|-------------|
| `model_name` | Model ID and effort level |
| `session_name` | Named session label |
| `context_window` | Context window usage (%, bar, or tokens) |
| `token_breakdown` | Cumulative input / output / cache token totals |
| `output_speed` | Output tokens per second for last API call |
| `premium_requests` | Number of premium API requests used |
| `last_call` | Token counts for the most recent API call |
| `cache_breakdown` | Separate cache read / write totals |
| `lines_changed` | Lines added / removed in this session |
| `git_branch` | Current git branch (with ahead/behind counts) |
| `git_status` | Working tree dirty/clean status |
| `tool_activity` | Recent tool calls with status icons |
| `agent_activity` | Spawned agents with type and status |
| `session_duration` | Elapsed session time |
| `session_cost` | Session cost in USD |
| `mtd_cost` | Month-to-date cost and projected monthly total |
| `cwd` | Current working directory |
| `separator` | Segment separator character |
| `newline` | Line break (start of second line) |

> `custom_command`, `custom_text`, and `custom_symbol` widgets are available but not offered in the configurator — add them manually to `config.json` if needed.

> **Difference from burnrate-claude:** burnrate-copilot has `session_name`, `premium_requests`, and `cache_breakdown` (copilot-specific). burnrate-claude has `last_call`, `output_speed`, and `lines_changed` in the configurator (both plugins have the latter two, but burnrate-claude also offers `last_call` as a configurable preset option). burnrate-copilot's Full preset is one-line; burnrate-claude's Full preset is two-line.

---

## setup

**Command file:** `commands/setup.md`  
**Script:** None (AI-driven)

### What it does

Configures GitHub Copilot CLI to use the burnrate-copilot statusline script. Unlike burnrate-claude (which auto-configures on first SessionStart), burnrate-copilot requires manual setup — this command is the primary installation mechanism.

### Invocation

```
/burnrate:setup
```

### Workflow

1. **Resolve the base directory** — `COPILOT_HOME` or `~/.copilot`.
2. **Find the plugin install path** — Checks `installed-plugins/local/` then `installed-plugins/` for `scripts/statusline.js`.
3. **Make `statusline.js` executable** — `chmod +x <path>/scripts/statusline.js`.
4. **Read `settings.json`** — Loads the current Copilot CLI settings; starts from `{}` if absent.
5. **Set `experimental: true`** — Required for statusline support.
6. **Configure `statusLine`** — Sets `settings.statusLine.type = "command"` and `settings.statusLine.command = <full path to statusline.js>`. If a statusLine already exists, asks before replacing.
7. **Ensure `footer.showCustom` is enabled** — If set to `false`, warns the user and offers to enable it.
8. **Write `settings.json`** — Saves updated settings with 2-space indentation.
9. **Write default `config.json`** — If `config.json` does not yet exist, writes a Standard-preset default. Existing configs are untouched.
10. **Print summary** — Lists all changes made; reminds the user to restart Copilot CLI.

> **Difference from burnrate-claude:** burnrate-claude auto-configures `settings.json` via the SessionStart hook (`statusline-config.js`) — no manual setup is normally required. burnrate-claude's `/burnrate-setup` skill is a diagnostic/troubleshooter, not an installer. burnrate-copilot's `/burnrate:setup` is the primary installation command.

---

## Adding a New Command

1. Create `commands/<name>.md` with a `# /burnrate:<name>` heading and `## Instructions` section.
2. If the command runs a script: create `skills/<name>/scripts/<name>.js`.
3. Register the command in `plugin.json` under `"commands": "commands/"` (this directory is already registered — any `.md` file added here is auto-discovered).
4. Test by invoking `/burnrate:<name>` in a Copilot CLI session.

For script-based commands:
- The script should read `COPILOT_HOME` (or `~/.copilot`) for data paths.
- Exit 0 on success; exit non-zero with a message on failure.
- Never prompt interactively — all interaction is handled by Copilot CLI.
- Use `PLUGIN_ROOT` env var (set by Copilot CLI) for references to other plugin files.
