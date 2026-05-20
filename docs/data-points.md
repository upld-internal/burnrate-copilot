# copilot-hud — Data Points

This document catalogs every data point captured by copilot-hud — what it is, where it comes from, what it enables, and whether it is useful input for the optimize skill.

Data points are grouped into two tiers:
- **Tier 1 — Currently tracked**: in the JSONL record today
- **Tier 2 — Planned (Phases 1–2)**: requires new hook registrations or script updates

The **Optimize column** marks data points the `burnrate-optimize` skill can use to generate actionable cost or efficiency recommendations.

---

## Tier 1 — Currently tracked

### `cost_usd`
| | |
|---|---|
| **Source** | Token delta × pricing from `pricing.json`; written as `last_known_cost` each turn, committed to JSONL at SessionEnd or crash recovery |
| **Hook** | StatusLine (every turn), SessionEnd, SessionStart (crash recovery) |
| **What it captures** | Estimated session cost in USD using Anthropic direct-API rates for the active model. Computed from the four token fields in `context_window` minus the session baseline snapshot. |
| **Insights** | Session cost, project cost, month-to-date total, projected monthly spend. The primary financial metric. |
| **Optimize relevance** | ✅ Core input. High-cost sessions and projects are the top candidates for optimization recommendations. |

---

### `model`
| | |
|---|---|
| **Source** | `model.id` from SessionStart stdin; `last_known_model` kept current by StatusLine |
| **Hook** | SessionStart, StatusLine |
| **What it captures** | The model ID in use (e.g., `claude-sonnet-4.6`, `gpt-4.1`). Stored in session file as `last_known_model`; written to JSONL as `model`. |
| **Insights** | Model breakdown in cost summary (which models account for what % of spend). Basis for model mix analysis. |
| **Optimize relevance** | ✅ If expensive models (Sonnet, Opus) are used for tasks that could be done with Haiku or GPT-4.1 mini, this is a major cost-reduction opportunity. |

---

### `project` / `project_id`
| | |
|---|---|
| **Source** | `path.basename(cwd)` from SessionStart; kept current as `last_known_project` by StatusLine |
| **Hook** | SessionStart, StatusLine |
| **What it captures** | Project name inferred from the working directory basename. `project_id` is the full path slug (e.g., `-Users-bripley-Projects-my-app`). |
| **Insights** | Per-project cost breakdown in cost summary. |
| **Optimize relevance** | ✅ High-cost projects warrant investigation into session patterns. |

---

### `final_tokens`
| | |
|---|---|
| **Source** | `context_window` fields from StatusLine stdin, written as `last_known_tokens` each turn |
| **Hook** | StatusLine (writes last_known_tokens), SessionEnd (reads and writes to JSONL) |
| **What it captures** | Cumulative token totals at session end: `total_input_tokens`, `total_output_tokens`, `total_cache_write_tokens`, `total_cache_read_tokens`. These are raw totals; subtract the session `snapshot` to get per-session deltas. |
| **Insights** | Token volume per session. Output tokens are a strong proxy for the amount of code/text generated. |
| **Optimize relevance** | ✅ High input-token sessions may benefit from a focused CLAUDE.md to reduce repeated context. |

---

### `date` / `start_month`
| | |
|---|---|
| **Source** | Wall clock at SessionEnd |
| **Hook** | SessionEnd |
| **What it captures** | ISO date (`2026-05-20`) and month key (`2026-05`) when the session ended. `start_month` determines which JSONL file the record is appended to. |
| **Insights** | Month-to-date aggregation, daily breakdown with `--daily` flag in cost summary. |
| **Optimize relevance** | ⬜ Time metadata only. |

---

## Tier 2 — Planned (Phase 1: Jira Integration)

### `jira_key` / `jira_costs` / `jira_keys_seen`
| | |
|---|---|
| **Source** | `git branch --show-current` parsed by `jira-detector.js`; optional `config.jira.project_keys` filter |
| **Hook** | StatusLine (detects and tracks per-turn); SessionEnd (finalizes attribution) |
| **What it captures** | The Jira ticket(s) worked on during the session. `jira_costs` is a map of `{ KEY → cost_usd }` when cost is split across multiple tickets in one session. Attribution is per-turn cost delta, so switching branches mid-session correctly splits the cost. |
| **Insights** | Per-Jira cost breakdown. Enables per-ticket AI spend tracking. |
| **Optimize relevance** | ⬜ Attribution data, not an optimization signal on its own. |

---

## Tier 2 — Planned (Phase 2: Session Telemetry)

### `turn_count`
| | |
|---|---|
| **Source** | `userPromptSubmitted` hook — one increment per user message |
| **Hook** | userPromptSubmitted |
| **What it captures** | Number of user prompts in the session. A proxy for turn count. |
| **Optimize relevance** | ✅ Very high turn counts with low output suggest excessive back-and-forth or repeated retries. |

---

### `tool_counts`
| | |
|---|---|
| **Source** | `preToolUse` hook — accumulated by tool name |
| **Hook** | preToolUse |
| **What it captures** | Map of tool name → call count. E.g., `{ "bash": 12, "view": 8, "edit": 4 }` |
| **Optimize relevance** | ✅ Sessions dominated by `view` with few `edit` calls may indicate excessive file exploration. High `bash` counts with test-run patterns may suggest iterative retry loops. |

---

### `ext_counts`
| | |
|---|---|
| **Source** | `postToolUse` hook — accumulated for file edit/create operations |
| **Hook** | postToolUse (edit, create) |
| **What it captures** | Map of file extension → edit count. E.g., `{ ".ts": 5, ".json": 2 }` |
| **Optimize relevance** | ✅ Understanding which file types are most frequently edited reveals which codebases drive token usage. |

---

### `git_branch`
| | |
|---|---|
| **Source** | `git branch --show-current` captured at session start |
| **Hook** | SessionStart |
| **What it captures** | The git branch active when the session began. |
| **Optimize relevance** | ⬜ Context field. Useful for per-branch cost analysis. |

---

### `duration_secs`
| | |
|---|---|
| **Source** | `last_known_stats.total_duration_ms` from StatusLine stdin if available; falls back to `now - started_at` |
| **Hook** | StatusLine (persists stats), SessionEnd (computes final) |
| **What it captures** | Wall-clock session duration in seconds. |
| **Optimize relevance** | ✅ Very long sessions relative to cost suggest idle time. Very short high-cost sessions suggest expensive per-turn reasoning. |

---

### `response_time_p50_ms` / `response_time_max_ms`
| | |
|---|---|
| **Source** | Timestamp delta between consecutive `userPromptSubmitted` events |
| **Hook** | userPromptSubmitted |
| **What it captures** | P50 and max response time across all turns in the session (milliseconds). |
| **Optimize relevance** | ✅ Consistently slow response times may indicate excessive context window fill. |
