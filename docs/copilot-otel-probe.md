# Copilot CLI OpenTelemetry and hook probe

Date: 2026-09-25
Host: GitHub Copilot CLI 1.0.88, macOS ARM64, model `gpt-5-mini`, non-interactive `copilot -p`

This records what the host emits so the Langfuse design rests on observed behavior. Proposed integration: [`burnrate-spec` Copilot Langfuse attribution](../../burnrate-spec/docs/spec/copilot-langfuse-attribution.md).

## There is no Langfuse plugin to pair with

Langfuse's [Copilot integration](https://langfuse.com/integrations/developer-tools/github-copilot) is Copilot's built-in OTel exporter pointed at Langfuse's OTLP endpoint through environment variables (`COPILOT_OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`). There is no Langfuse hook handler to wrap, unlike Codex's `tracing@codex-observability-plugin`. `copilot help monitoring` documents the variables. The exporter supports `otlp-http` (JSON or protobuf) and a JSON-lines `file` exporter, and it refuses cleartext `http://` endpoints.

## Native span attributes

One turn produced an `invoke_agent` root span with `chat <model>` and `execute_tool <tool>` children. Relevant attributes:

| Span | Attribute | Observed value |
| --- | --- | --- |
| `invoke_agent` | `github.copilot.git.branch` | `main` |
| `invoke_agent` | `github.copilot.git.repository` | `upld-internal/burnrate-copilot` (owner/repo, no host) |
| `invoke_agent` | `github.copilot.git.commit_sha` | full SHA |
| `invoke_agent` | `github.copilot.github.org` | `upld-internal` |
| `invoke_agent`, `chat` | `github.copilot.nano_aiu` | `378795000.0` |
| `invoke_agent`, `chat` | `gen_ai.conversation.id` | the Copilot session ID |
| `invoke_agent` | `enduser.pseudo.id` | a pseudonymous hash |

There is no Jira attribute. `OTEL_RESOURCE_ATTRIBUTES` values pass through as resource attributes. Langfuse [maps](https://langfuse.com/integrations/native/opentelemetry) only span attributes named `langfuse.trace.metadata.*` to top-level filterable metadata. Other span attributes land under `metadata.attributes`, and resource attributes under `metadata.resourceAttributes`, and neither is filterable. The documented session source is `session.id` or `langfuse.session.id`, not `gen_ai.conversation.id`.

## Hook timing against span export

A local plugin loaded with `--plugin-dir` registered command hooks for `sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `agentStop`, and `sessionEnd`. Each hook recorded its stdin and which spans the file exporter had written. Repository-level `.github/hooks/*.json` hooks did not fire in the same non-interactive run.

| Offset | Hook | Spans already in the file |
| ---: | --- | --- |
| 0.00 s | `userPromptSubmitted` | none |
| 0.24 s | `sessionStart` | none |
| 36.21 s | `preToolUse` | none |
| 36.67 s | `postToolUse` | none |
| 49.70 s | `agentStop` | `execute_tool bash`, `chat`, `chat` |
| 49.91 s | `sessionEnd` | same three |

The `invoke_agent` root span ended about 400 ms after `agentStop` fired and after `sessionEnd`. That root span is the one carrying `git.branch`, `git.repository`, and the turn's total `nano_aiu`. **A hook-driven drain of the exporter file cannot see the root span of the turn in progress, and never sees the last turn of a session.** A file relay is therefore rejected.

## Hook trace context

Every hook except `userPromptSubmitted` receives `traceparent` in stdin, and `COPILOT_TRACEPARENT` in the environment:

- `sessionStart`, `agentStop`, `sessionEnd`: the turn's root `invoke_agent` span.
- `preToolUse`, `postToolUse`: the current `chat` span.

The trace ID matched the exported spans. A hook can therefore send its own span into the same trace, as a child of the root span. Command hooks also receive `PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`, `COPILOT_PLUGIN_DATA`, `COPILOT_PROJECT_DIR`, and `COPILOT_CLI_BINARY_VERSION`. `OTEL_*` and `COPILOT_OTEL_*` variables are removed from the hook environment; other user variables pass through.

## Hook stdin fields

All hooks: `sessionId`, `timestamp` (epoch milliseconds), and `cwd`. Per event:

- `sessionStart`: `source`, `initialPrompt` (content), `traceparent`
- `userPromptSubmitted`: `prompt` (content)
- `preToolUse`: `toolName`, `toolArgs` (content), `traceparent`
- `postToolUse`: same as `preToolUse`, plus `toolResult` (content)
- `agentStop`: `transcriptPath`, `stopReason`, `stop_hook_active`, `traceparent`
- `sessionEnd`: `reason`, `traceparent`

Content fields are excluded from [`src/hook.rs`](../src/hook.rs) types, and the tests prove they are dropped. Scrubbed payloads are in `fixtures/hooks/`.

## Langfuse child-span write

Target: the self-hosted Langfuse 4.44.0 project `team-aws-model-router-dev`. The Copilot host exporter sent to `<base>/api/public/otel` with `x-langfuse-ingestion-version=4`. A probe `agentStop` hook sent one `burnrate.attribution` span in a separate OTLP/HTTP JSON request. Its parent was the hook's `traceparent`, and it set `langfuse.trace.metadata.{git_branch,git_repository,jira_key,jira_keys,event_type}`, `langfuse.session.id`, and `langfuse.trace.tags`.

- **Environment:** Copilot removes every `OTEL_*` and `COPILOT_OTEL_*` variable from the hook environment. The first attempt failed because `OTEL_EXPORTER_OTLP_HEADERS` was absent. `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `COPILOT_TRACEPARENT` do pass through.
- **Send:** HTTP 200 in 330 ms, queued as an `otel-ingestion-job`. The Burnrate span arrived before the host's root span.
- **Read-back** of trace `e7bf0a2d08c4c196f048b007f487e7ec`: the name is `invoke_agent`, and the session is the Copilot session ID. The top-level metadata is `git_branch=ABC-123-flush-probe`, `git_repository=upld-internal/burnrate-copilot`, `jira_key=ABC-123`, `jira_keys=ABC-123`, and `event_type=burnrate.probe`. Tags are `burnrate-probe`. Observations are `invoke_agent` (AGENT), `chat gpt-5-mini` (GENERATION, with cost), and `burnrate.attribution` (SPAN), and both children point to the root.
- **Filtering:** `GET /api/public/traces` with a `stringObject` filter on `metadata.jira_key = ABC-123` returned only this trace.
- **Control:** two host-only traces from the failed attempts (sessions `446cfec5…` and `a92abfe4…`) have no top-level metadata and no tags, but already carry their Copilot session ID. Setting `langfuse.session.id` is therefore unnecessary.

The probe traces are tagged `burnrate-probe` and carry `event_type=burnrate.probe`.

## End-to-end plugin run

Development build 0.5.0, staged with `scripts/stage-dev-plugin.sh` and loaded with `copilot --plugin-dir plugin/burnrate-copilot`. One tool-using turn ran in a repository on branch `ABC-123-flush-probe`, with `origin` set to `git@github.com:upld-internal/burnrate-copilot.git`, in session `7e39bf9f-3413-46ab-aab6-8df30ae808af`.

- **Local store:** `session.started`, `tool.completed`, and `session.ended` events, each with an attribution snapshot and a `attribution.git` capability, and a finalized session summary. The store contained neither the tool name nor its arguments.
- **`langfuse status`:** `configured`, last attempt `sent` with HTTP 200 from the detached sender.
- **Langfuse trace `3dd6d993259bab223923e414390ad035`:** top-level metadata `harness=copilot_cli`, `git_branch=ABC-123-flush-probe`, `git_repository=upld-internal/burnrate-copilot`, `jira_key=ABC-123`, and `jira_keys=ABC-123`. Observations: `invoke_agent` (AGENT) with children `bash` (TOOL), two `chat gpt-5-mini` (GENERATION), and one `burnrate.attribution` (SPAN).

## Content capture

The end-to-end run above had `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` unset, which is the host default. Its trace had empty input and output. Two further runs had it set to `true`:

- **Trace `f775ce1e63eeef7de1911a3cd827afd4`** (a shell-tool prompt): the trace and `invoke_agent` input held the system and user messages, and the output held the final answer. Each `chat` generation had its messages, model, token usage including reasoning tokens, and a Langfuse-computed cost. The `bash` tool had its command as input and the command output as output.
- **Trace `9bc9115868442c792cb374e9c45e3578`** (a file-reading prompt, four model calls and three tool calls): every generation and tool had input. One `view` call targeted a missing path; Langfuse recorded it with level `ERROR` and status `Path does not exist` rather than an output.

Both traces kept the Burnrate top-level metadata. The `burnrate.attribution` span has no input or output by design. Langfuse's cost is its own price-table estimate; Copilot's `github.copilot.nano_aiu` stays nested under `metadata.attributes`.

## Trace list input and output

Langfuse's trace list shows trace-level input and output. Codex's Langfuse plugin sets them explicitly (`setTraceIO`, to the prompt and the final answer). Copilot sets neither, so Copilot rows are blank in the list even with content capture on; the detail view shows the root span's messages. Copilot also sends no user ID, only a hashed `enduser.pseudo.id` under the nested attributes.

`BURNRATE_LANGFUSE_TURN_IO=true` sets `langfuse.trace.input` and `langfuse.trace.output` on the Burnrate span from the session transcript:

- **First attempt** (read in the hook, trace `c9baebdd33469c64cf1e085b3e77eb9d`): the input was correct, but the output was an interim message. The transcript logged the final `assistant.message` at `02:35:39.109` and the `agentStop` `hook.start` at `.114`, and the hook's read missed the last line.
- **Fixed** (the detached sender waits for the turn's `agentStop` marker, trace `5f4afe0427ebf3dc1bb16c6cb95e5823`): the list showed the prompt as input, and the output `The README contains a single line with the word "hi."`, matching the transcript's final message.

The Burnrate span now sends no resource attributes. Earlier its `service.name=burnrate-copilot` resource was copied onto the trace's `metadata.resourceAttributes`; after the change the trace shows Copilot's `service.name=github-copilot` and `service.version=1.0.88`.

## Trace name

Langfuse names a trace after its root span unless `langfuse.trace.name` is set. Codex's Langfuse plugin sets `Codex Turn`; Copilot's root span is `invoke_agent`. With `langfuse.trace.name=Copilot Turn` on the Burnrate span, trace `e52373d8111d5b290a268f0e237e1501` (session `a0c080eb-10cb-44c6-b825-707b9254a10f`) was listed and opened as `Copilot Turn`, and a traces API filter on `name=Copilot Turn` returned it. The `invoke_agent` observation kept its name, and traces sent earlier keep `invoke_agent`.

## Open questions

- Does `agentStop` fire exactly once per interactive turn, and does it fire for aborted turns? All runs above were non-interactive, with one turn.
- Plugin hook `exec` plus `args` form (from the cross-platform hook spec) versus the `command` string used here.
