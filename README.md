# Burnrate Copilot

Burnrate Copilot is the GitHub Copilot CLI host adapter for [Burnrate's shared contracts](../burnrate-spec/README.md). Its plugin records supported Copilot lifecycle and tool events locally. When Copilot's built-in OpenTelemetry export sends traces to Langfuse, Burnrate adds `git_branch`, `git_repository`, `jira_key`, and `jira_keys` to each turn's trace when those facts are available.

This is a Rust rewrite that consumes the pinned `burnrate-adapter-kit`, following [Burnrate Codex](../burnrate-codex/README.md). The earlier JavaScript plugin was removed; it was not a shared-contract consumer. There is no signed release yet. The plugin runs from a local development build on macOS and GNU/Linux.

## How it works

```text
Copilot CLI ──OTel export──────────────────────────────────> Langfuse trace (invoke_agent, chat, tools)
     │                                                                 ^
     └─ plugin hooks ─> burnrate-copilot ─> adapter kit ─> local records
                              └─ agentStop ─> burnrate.attribution span ┘
```

- **Local records:** `sessionStart`, `postToolUse`, and `sessionEnd` create normalized session and tool events with event-time Git and Jira attribution. Prompt, tool arguments, tool results, and transcripts are discarded when the hook input is read.
- **Langfuse metadata:** Copilot's exporter sends each turn as a trace, but its Git attributes are not filterable in Langfuse and it sends no Jira key. At `agentStop`, Burnrate sends one `burnrate.attribution` span into that trace, as a child of the turn's root span, with `langfuse.trace.metadata.*` attributes. It also names the trace `Copilot Turn`, matching Codex's `Codex Turn`, instead of the default `invoke_agent`. Langfuse promotes those to top-level, filterable trace metadata. The span is sent from a detached process so the turn is not delayed.

Details and evidence are in the [Copilot OTel and hook probe](docs/copilot-otel-probe.md) and the [integration specification](../burnrate-spec/docs/spec/copilot-langfuse-attribution.md).

## Langfuse setup

Copilot hides its own `OTEL_*` settings from plugin hooks, so two sets of variables are needed in the environment that starts Copilot, and both must point at the **same Langfuse project**:

```sh
# Copilot's exporter
export COPILOT_OTEL_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<langfuse-host>/api/public/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20<base64 public:secret>,x-langfuse-ingestion-version=4"
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true   # prompts, responses, tool input/output

# Burnrate's metadata span
export LANGFUSE_BASE_URL="https://<langfuse-host>"
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export BURNRATE_LANGFUSE_TURN_IO=true   # prompt and final answer in the trace list
export LANGFUSE_COPILOT_USER_ID="you@uplandsoftware.com"   # Langfuse trace user
```

The team configuration keeps content capture on. Without `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`, trace and observation input and output stay empty. With it, Copilot sends its system prompt, user prompts, model responses, and tool arguments and results, which can include source code and command output, to Langfuse. That setting controls only Copilot's exporter; Burnrate's span carries metadata and never content. Copilot sets no trace-level input or output, so Langfuse's trace list is blank for Copilot traces even with capture on. With `BURNRATE_LANGFUSE_TURN_IO=true`, Burnrate's span sets them, like Codex traces, to the turn's prompt and final answer from Copilot's session transcript. Burnrate passes that text straight to Langfuse and stores none of it. Langfuse's cost column is its own price-table estimate from token counts; Copilot's AI Credits figure arrives as the nested `github.copilot.nano_aiu` attribute. Copilot sends no user identity, so `LANGFUSE_COPILOT_USER_ID` sets the Langfuse trace user, as `LANGFUSE_CODEX_USER_ID` does for Codex. The plugin's `setup-langfuse` skill walks through these variables. It suggests your `git config user.email` for the user ID only when that is an `@uplandsoftware.com` address, and otherwise asks you to type it. `burnrate-copilot langfuse status` reports whether the destination is configured and the outcome of the last turn. `sent` means Langfuse accepted the request; confirm the metadata on the trace in Langfuse.

## Try the development plugin

```sh
./scripts/stage-dev-plugin.sh
copilot --plugin-dir plugin/burnrate-copilot
```

The staging script builds the host-native release binary into `plugin/burnrate-copilot/bin/`. Local data lives under `~/Library/Application Support/burnrate-copilot` on macOS and `${XDG_STATE_HOME:-~/.local/state}/burnrate-copilot` on Linux; `config/attribution.json` there can override the shared Jira-key rule.

## Development

Rust 1.85 or newer is required. The shared dependency is pinned to an immutable `burnrate-spec` revision in `Cargo.toml` and `Cargo.lock`.

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
```

The implementation is under `src/` (`hook.rs` input, `runtime.rs` local records, `langfuse.rs` metadata span), the plugin under `plugin/burnrate-copilot/`, and observed hook payloads under `fixtures/hooks/`. Read [AGENTS.md](AGENTS.md) before changing code.

## Not built yet

- The statusline command and its user `statusLine` setting ownership.
- Plugin installation from a marketplace, signed multi-target releases, upgrade, and rollback.
- A verified Windows install. Windows hooks, data paths, and the detached sender are implemented, and CI builds and smoke-tests the x64 binary, but no Copilot session on Windows has run them yet. Windows on ARM would run the x64 binary under emulation.
- Verification that `agentStop` fires once per interactive turn, including aborted turns.
