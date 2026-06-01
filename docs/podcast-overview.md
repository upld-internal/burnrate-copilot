# burnrate — Project Overview for NotebookLM

*This document is intended as a source for NotebookLM podcast generation. It covers both burnrate-copilot (GitHub Copilot CLI) and burnrate-claude (Claude Code CLI) as a unified project.*

---

## The problem: AI tooling is a black box for cost

Modern AI-assisted development tools — GitHub Copilot CLI and Claude Code — give you powerful agentic capabilities but almost no cost transparency. You know you're spending money. You don't know how much, which sessions are expensive, which models you're using most, or what the month is going to look like on your bill.

GitHub Copilot CLI shows a quota indicator and a rate limit counter. It does not show dollar figures. Claude Code shows the current session cost in the UI, but it resets on every session and does not aggregate. Neither tool gives you a month-to-date total, a projected monthly figure, or any way to understand your patterns across time.

This is not a trivial gap. Teams using these tools as daily drivers are running $50–200+/month in AI compute, and without visibility they have no feedback loop to improve. Engineers who see their spend make different decisions — they compact earlier, they pick the right model for the task, they notice when a session has gone off the rails.

The burnrate project exists to close that gap.

---

## Two plugins, one concept

The burnrate project is two parallel plugins — one for each tool:

**burnrate-copilot** targets GitHub Copilot CLI. It is installed as a Copilot plugin and renders a cost display in the Copilot CLI footer, updated on every turn.

**burnrate-claude** targets Claude Code. It is installed as a Claude Code plugin via the plugin marketplace and renders the same display in the Claude Code statusline.

Both plugins store data locally in the user's config directory. No data is sent to any server. No network calls. The cost computation happens entirely on the client side.

Both plugins write session records to the same JSONL schema, which was designed to enable a future unified cost-summary command that spans both tools — one report for all your AI spend regardless of which tool generated it.

---

## What you see: the statusline

When either plugin is installed, every turn in the CLI shows a footer line like this:

```
$0.08 session  |  May: $6.21 (~$41/mo)  |  claude-sonnet-4.6  |  28%  |  8m  |  main ✎
```

Reading left to right:

- **$0.08 session** — what this session has cost so far
- **May: $6.21 (~$41/mo)** — month-to-date across all sessions, plus a linear projection of where the month will land
- **claude-sonnet-4.6** — the active model
- **28%** — context window utilization (how full the model's context is)
- **8m** — how long this session has been running
- **main ✎** — the current git branch, with an indicator if there are uncommitted changes

When you're working on a Jira ticket, the active ticket key also appears — more on that later.

---

## Session lifecycle and data persistence

Understanding the session lifecycle is important for both using the plugin correctly and contributing to it.

When a session starts, the `sessionStart` hook fires. The plugin writes a JSON session file capturing the session ID, start time, model, current working directory, git branch, and a baseline cost snapshot. On every turn of the session, the statusline command runs, computing the current session cost against that baseline. The result is written back to the session file as `last_known_cost` and `last_known_tokens`, along with a timestamp. These fields serve two purposes: they update the statusline display, and they act as a recovery snapshot in case the session ends abnormally.

At clean session end, the `sessionEnd` hook fires. The plugin reads `last_known_nano_aiu`, computes the final cost using GitHub's AI Credits formula, and appends a completed record to the monthly JSONL file. The session file is then deleted.

The interesting engineering case is what happens when a session ends abnormally — typically a user pressing Ctrl+C. In this case, `sessionEnd` never fires. The session file remains on disk. On the next session start, the `sessionStart` hook scans the sessions directory for files older than two minutes that don't match the current session ID. For each one found, it computes the final cost from `last_known_tokens` and writes a recovery record to the JSONL before deleting the orphaned file. The two-minute grace period prevents incorrectly recovering sessions that may be running concurrently in another terminal.

This orphan recovery mechanism means that even if you always quit with Ctrl+C, your costs are always captured and nothing accumulates as unrecovered orphans.

---

## Monthly data and projections

Completed session records are stored in `monthly/YYYY-MM.jsonl` — one JSON record per line, one line per completed session. The schema captures: session ID, date, model, project name, project ID (derived from the working directory path), cost in USD, and Jira attribution when available.

The month-to-date total shown in the statusline is the sum of all records in the current month's JSONL file, plus the current in-progress session's running cost. The projected monthly figure is a linear extrapolation: (MTD cost / days elapsed) × days in month.

The projection is unreliable on day one of the month — a single large session can skew it dramatically. It becomes meaningful after the first week of usage. Both plugins make this limitation explicit in their documentation.

---

## Jira attribution: connecting AI spend to work items

The Jira integration is a feature that requires no configuration to work and produces high-value output for teams.

When the plugin writes a session file at session start, it captures the current git branch. If the branch name contains a pattern matching `[A-Z]+-\d+` — for example, `feature/PLAT-4821-new-search-index` — the plugin extracts `PLAT-4821` as the Jira ticket key.

On every turn, the active git branch is re-checked. If you switch branches mid-session (common during rebases or context switches), the attributed ticket updates. When the session ends and the JSONL record is written, it includes both the primary attributed ticket and a cost breakdown by ticket for sessions that touched multiple branches.

This flow means that at the end of the month, running the cost-summary skill can tell you not just how much you spent per project, but how much you spent per ticket. For teams doing sprint retrospectives or estimating the AI cost of upcoming tickets, this is genuinely useful data.

The attribution uses branch naming conventions that most teams already follow without any changes to their workflow. The only optional configuration is a `project_keys` allowlist that prevents false positives from branches that happen to match the pattern for unrelated reasons.

---

## The skills: analysis beyond the statusline

Both plugins ship with a set of skills — slash commands that run analysis scripts against the accumulated session data.

### Cost summary

The cost-summary skill produces a structured report for any month or date range. It shows the total cost broken down by model, by project, and optionally by Jira ticket. For teams using Jira attribution, this turns raw session data into a complete picture of AI compute spend attributable to specific work.

A typical output shows something like: this month you spent $47 total. 
- $32 was on the `auth-service project`, split across `JIRA-4821` and `JIRA-4902`.
- The remaining $15 was on `burnrate-copilot` itself.

### Optimize

The optimize skill runs a deeper analysis over a rolling window (default 30 days) and produces a scored health report. The score is 0–100. The checks include:

- **Model mix efficiency**: what fraction of spend is on premium models vs. cheaper alternatives? Are you using Opus for tasks that Sonnet would handle just as well?
- **Session length distribution**: are you running extremely long sessions when compacting would reduce cost? Long sessions with high context utilization are expensive because you're paying full input token rates for a context that could be compressed.
- **Tool usage patterns**: what tools are you calling most? Frequent `web_fetch` calls, repeated reads of the same files, and large bash output without truncation are common patterns that inflate token counts unnecessarily.
- **Outlier sessions**: are there specific sessions that account for a disproportionate share of monthly spend? These often reveal specific inefficient workflows.

The output is prioritized — the most impactful recommendation comes first with a description of what to change and approximately how much it would save.

---

## Privacy and data model

Both plugins take a deliberately minimal approach to data storage.

All data is local. The session files, the monthly JSONL records, and the configuration all live in a subdirectory of the user's AI tool config directory — `~/.copilot/plugin-data/burnrate-copilot/` for the Copilot plugin and `~/.claude/burnrate-claude/` for the Claude plugin. Nothing is sent to any server. The plugins make no network calls of any kind.

Session files are ephemeral — they exist only during an active session and are deleted when the session ends cleanly. What persists long-term is only the JSONL records, which contain the final aggregated cost and attribution data for each completed session. No token-by-token history is stored.

The debug mode that captures full hook payloads is explicitly opt-in via an environment variable and disabled by default.

---

## Technical architecture: contributing to burnrate

Both plugins are written in plain Node.js with no runtime npm dependencies. This was a deliberate choice to minimize the installation surface — the plugin scripts run directly with the Node.js binary that's already on the user's PATH, without any package installation step.

The key architectural components are the same in both plugins:

**session-start.js** — handles the sessionStart hook. Writes the session file, captures the git branch, performs orphan recovery, and ensures the statusline is configured.

**statusline.js** — the entry point for the statusline command. Reads stdin, calls the compositor, and writes rendered output to stdout.

**compositor.js** — the core of the plugin. Loads the session file, computes the current session cost, loads the MTD total from the JSONL, and assembles the data object passed to each widget.

**session-end.js** — handles the sessionEnd hook. Computes final cost, appends the JSONL record, deletes the session file.

**pricing.js** — MTD computation: `getMtdAndProjected` sums the monthly JSONL and computes the projected monthly spend.

**widgets/** — individual display components. Each widget receives the compositor's data object and returns a formatted string. Widgets include: cost, context window, git, session (elapsed time), Jira ticket, tools (recent tool activity), and a custom widget for passthrough of an existing statusline command.

For burnrate-copilot specifically, the `hooks.json` file at the repo root registers five hooks: `sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, and `sessionEnd`. The pre/post tool use hooks and the user prompt hook feed into a real-time activity display and the telemetry fields in the JSONL records (turn counts, tool usage frequency, file type breakdown).

---

## Design decisions worth discussing

Several decisions in this project have non-obvious rationale that's worth surfacing.

**Why token-based cost computation for Copilot instead of native cost?**
GitHub Copilot CLI's statusline payload includes no cost field whatsoever. The only option is token-based computation. This actually turned out to be an advantage — the full token breakdown makes every cost component visible and auditable, whereas burnrate-claude treats `cost.total_cost_usd` as a black box.

**Why JSONL instead of a database?**
JSONL (newline-delimited JSON) is trivially appendable, trivially readable, trivially debuggable, and trivially portable. The files are human-readable, easily grep-able, and require no schema migration when new fields are added. The cost is that queries require reading the whole file, but monthly session counts are small enough that this is never a performance concern.

**Why a zero-baseline snapshot instead of absolute token counts?**
Copilot CLI resets token counts to zero at session start, so a zero baseline is technically correct. The snapshot pattern was carried over from burnrate-claude where it was needed to handle the case where Claude Code's cumulative cost persists across sessions. In the Copilot version, it simplifies the code by making the computation identical regardless of what the initial token values happen to be.

**Why the 2-minute orphan recovery grace period?**
Users sometimes run multiple Copilot CLI sessions concurrently — one per terminal tab, for instance. If Session A starts and then Session B starts before Session A has had its first turn, Session B's orphan scan would incorrectly identify Session A's file as an orphan (since it was started less than 2 minutes ago but hasn't had a `last_known_at` written yet). The 2-minute grace period prevents this false positive at the cost of a small delay in recovering genuinely orphaned sessions.

---

## Future directions

Several features are on the roadmap that extend the plugin from a passive cost display into an active workflow tool.

**Built-in model routing** would automatically select the right-sized model for a given task — routing simple lookups to Haiku or Sonnet while reserving Opus for complex multi-step work. This closes the feedback loop on one of the most actionable optimize recommendations: model mix efficiency.

**Model and tool blocking** would let teams or individuals set guardrails — preventing specific models or tools from being used, enforcing cost ceilings per session, or requiring confirmation before invoking expensive operations.

**SDLC workflow distribution** is a broader vision: using the plugin infrastructure to distribute codified team workflows as skills and commands. Patterns for working with Jira, Confluence, Git, test suites, and documentation can be packaged and updated centrally, giving every engineer on a team the same set of battle-tested prompting patterns without each person having to discover and maintain them individually.

**Safety checks via hooks** would enable teams to configure pre-action checks that run before sensitive operations — for example, scanning a git diff for API tokens or passwords before a commit, or requiring a linked Jira ticket before starting a session on a production codebase.

**Push AI cost and token data to Jira** would close the attribution loop: rather than just tagging session records with a ticket key, the plugin would write the actual AI cost back to a Jira field on the ticket. Sprint velocity reports and ticket estimates would then include AI compute as a first-class cost alongside engineer time.

**Developer telemetry to the cloud** is the enterprise reporting layer: aggregating model usage, context window utilization, work item attribution, and session patterns across an entire team into a dashboard. This turns individual cost visibility into organizational insight — identifying which projects are AI-heavy, which workflows are inefficient at scale, and where investment in better tooling or prompting practices would have the highest leverage.
