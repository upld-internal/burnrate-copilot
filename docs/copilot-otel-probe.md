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

The trace ID matched the exported spans. A hook can therefore send its own span into the same trace, as a child of the root span. Command hooks also receive `PLUGIN_ROOT`, `COPILOT_PLUGIN_ROOT`, `COPILOT_PLUGIN_DATA`, `COPILOT_PROJECT_DIR`, and `COPILOT_CLI_BINARY_VERSION`. OTel variables from the user's shell are inherited as usual.

## Hook stdin fields

All hooks: `sessionId`, `timestamp` (epoch milliseconds), and `cwd`. Per event:

- `sessionStart`: `source`, `initialPrompt` (content), `traceparent`
- `userPromptSubmitted`: `prompt` (content)
- `preToolUse`: `toolName`, `toolArgs` (content), `traceparent`
- `postToolUse`: same as `preToolUse`, plus `toolResult` (content)
- `agentStop`: `transcriptPath`, `stopReason`, `stop_hook_active`, `traceparent`
- `sessionEnd`: `reason`, `traceparent`

Content fields are excluded from [`src/hook.rs`](../src/hook.rs) types, and the tests prove they are dropped. Scrubbed payloads are in `fixtures/hooks/`.

## Open questions

- Does Langfuse apply `langfuse.trace.metadata.*` from a **non-root** span in the trace, arriving in a separate OTLP request? This needs a live write and read-back against a Langfuse test project.
- Does `agentStop` fire exactly once per interactive turn, and does it fire for aborted turns? The run above was non-interactive, with one turn.
- Plugin hook `exec` plus `args` form (from the cross-platform hook spec) versus the `command` string used here.
