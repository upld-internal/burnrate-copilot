# burnrate-copilot — Data Points

This document catalogs every data point captured by burnrate-copilot — what it is, where it comes from, what it enables, and whether it is useful input for the optimize skill.

The **Optimize column** marks data points the `/burnrate:burnrate-optimize` skill can use to generate actionable cost or efficiency recommendations.

---

## Tracked fields (JSONL record)

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
| **Source** | `model.id` from StatusLine stdin; written to session file as `last_known_model` each turn by the compositor. **Note:** `model.id` is not available in sessionStart stdin — only StatusLine (interactive TUI sessions) populates it. `--prompt` sessions produce `"model": ""` in JSONL. |
| **Hook** | StatusLine |
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

## Jira attribution fields

### `jira_key` / `jira_costs` / `jira_keys_seen` / `jira_source`
| | |
|---|---|
| **Source** | `git branch --show-current` parsed by `jira-detector.js`; optional `config.jira.project_keys` filter |
| **Hook** | StatusLine (detects and tracks per-turn); SessionEnd (finalizes attribution) |
| **What it captures** | The Jira ticket(s) worked on during the session. `jira_costs` is a map of `{ KEY → cost_usd }` when cost is split across multiple tickets in one session. Attribution is per-turn cost delta, so switching branches mid-session correctly splits the cost. `jira_source` is always `"branch"`. When multiple tickets were seen, `jira_keys_seen` lists all keys. |
| **Insights** | Per-Jira cost breakdown. Enables per-ticket AI spend tracking. |
| **Optimize relevance** | ⬜ Attribution data, not an optimization signal on its own. |

---

## Session telemetry fields

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

### `turn_interval_p50_ms` / `turn_interval_max_ms` / `turn_interval_count`
| | |
|---|---|
| **Source** | Timestamp delta between consecutive `userPromptSubmitted` events |
| **Hook** | userPromptSubmitted |
| **What it captures** | P50 and max elapsed time between user prompts across all turns in the session (milliseconds), plus the count of measured intervals. Measures combined user think-time + AI response time (Copilot has no assistant-complete hook, so pure AI latency cannot be isolated). |
| **Optimize relevance** | ✅ Consistently long intervals may indicate excessive context window fill slowing AI responses. |

---

### `subagent_count` / `subagent_types`
| | |
|---|---|
| **Source** | `preToolUse` hook — accumulated for tool calls that spawn sub-agents |
| **Hook** | preToolUse |
| **What it captures** | Total number of sub-agents spawned in the session and a breakdown by type (e.g. `{ "general-purpose": 2, "explore": 1 }`). |
| **Optimize relevance** | ✅ Frequent sub-agent spawning multiplies token usage. Sessions with high `subagent_count` relative to `turn_count` are strong candidates for reviewing delegation patterns. |

---

### `prompt_count` / `prompt_length_p50_bytes` / `prompt_length_max_bytes`
| | |
|---|---|
| **Source** | `userPromptSubmitted` hook — `prompt.length` accumulated into `session.prompt_lengths[]` per turn. P50/max computed by `buildTelemetryFields` at session-end. |
| **Hook** | userPromptSubmitted |
| **What it captures** | Total number of user prompts and the P50/max byte length of prompt text. Raw prompt content is never persisted to disk; only lengths are stored. |
| **Optimize relevance** | ✅ Very large prompts (max > 50KB) often contain pasted file content that should be provided via file path instead. |

---

### `web_search_requests` / `web_fetch_requests`
| | |
|---|---|
| **Source** | `preToolUse` hook — checks `toolName.toLowerCase()` for `web_search`/`websearch` and `web_fetch`/`webfetch`. Counters accumulated in session file. |
| **Hook** | preToolUse |
| **What it captures** | Number of web search and web fetch tool calls in the session. Only written to JSONL when > 0. |
| **Optimize relevance** | ✅ High web usage in sessions that could use cached/offline reference material may indicate inefficient information gathering patterns. |

---

### `tool_duration_p50_ms` / `tool_duration_max_ms`
| | |
|---|---|
| **Source** | `preToolUse` writes a FIFO start-time queue per tool (`session.tool_start_times[toolName][]`). `postToolUse` pops the oldest entry and computes `endTs - startTs`. Durations > 5 minutes are discarded (stale state guard). All durations accumulated in `session.tool_durations_ms[]`. P50/max computed by `buildTelemetryFields` at session-end. |
| **Hook** | preToolUse (start), postToolUse (end) |
| **What it captures** | P50 and max execution time across all tool calls in the session (ms). FIFO queuing handles parallel same-name tools without clobbering. |
| **Optimize relevance** | ✅ High `tool_duration_max_ms` with slow bash commands suggests long-running test or build steps that may benefit from caching or faster alternatives. |

---

### `turn_tokens`
| | |
|---|---|
| **Source** | StatusLine compositor (`compositor.js`) — accumulates per-turn input/output/cache deltas from cumulative `context_window` tokens into `session.turn_tokens[]` on every StatusLine fire. Multi-fire resilient: if the compositor fires multiple times within the same turn (same `turn_count`), the delta is accumulated into the existing entry. Array capped at 100 entries. Written to JSONL by `buildTelemetryFields` at session-end. |
| **Hook** | StatusLine |
| **What it captures** | Per-turn token breakdown: `{ turn, input, output, cache_write, cache_read }` for each of the last ≤100 turns. The `turn` field matches the `turn_count` at time of the call. Omitted from JSONL when no tokens were exchanged. |
| **Optimize relevance** | ✅ Identifies outlier turns with unusually high input or output tokens. Cross-referencing with tool activity can reveal which specific operations (long file reads, large code generations) drive cost spikes. |

